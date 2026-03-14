import axios from 'axios';
import '../utils/loadEnv.js';
import config from '../config.js'; // Updated import
import { supabase } from '../clients/supabase.js';
import { modifyRegistryComponents } from '../utils/embedManager.js';

// Configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Role Definitions
// Ordered from highest min to lowest for easier searching if needed, 
// but find() works fine with the range check.
const LEVEL_ROLES = [
    { min: 100, max: Infinity, id: '1469958213997821952' },
    { min: 75, max: 100, id: '1469958222420119715' },
    { min: 50, max: 75, id: '1448029023530913946' },
    { min: 30, max: 50, id: '1448029024948326472' },
    { min: 12, max: 30, id: '1448029028970664088' },
    { min: 5, max: 12, id: '1448029030283477074' },
    { min: 1, max: 5, id: '1469956018908823716' }
];

const ALL_ROLE_IDS = LEVEL_ROLES.map(r => r.id);

// Load Keys
const keys = [
    process.env.GROQ_API_KEY_ONE,
    process.env.GROQ_API_KEY_TWO,
    process.env.GROQ_API_KEY_THREE,
    process.env.GROQ_API_KEY_FOUR
].filter(k => k);

if (keys.length === 0) {
    console.error("No Groq API keys found in .env");
}

// Helper to call Groq with infinite retry
async function extractLevelFromImage(imageUrl) {
    let keyIndex = 0;
    let attempts = 0;
    const MAX_RETRIES = 10; // Prevent infinite loops

    while (attempts < MAX_RETRIES) {
        attempts++;
        const apiKey = keys[keyIndex];

        try {
            const payload = {
                model: config.ai.visionModel,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `Analyze this image.
                                There are two big numbers on either side of a green bar. The number on the left is the current level, and the number on the right is the next level. 
                                Return JSON with a single key "level" containing the number on the left as an integer.
                                If you cannot clearly see the numbers or if there is no level bar, return {"level": null}.`
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: imageUrl
                                }
                            }
                        ]
                    }
                ],
                response_format: { type: "json_object" }
            };

            const response = await axios.post(GROQ_API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            const content = response.data.choices[0].message.content;
            try {
                const result = JSON.parse(content);
                return result.level;
            } catch (e) {
                console.error("Failed to parse JSON from AI response:", content);
                return null;
            }

        } catch (error) {
            if (error.response && error.response.status === 429) {
                // Rate limited - Rotate key
                keyIndex = (keyIndex + 1) % keys.length;
                console.log(`Rate limit hit (429). Switching to key index ${keyIndex} and retrying...`);
                // Add a small delay to avoid hammering if all keys are exhausted quickly
                if (keyIndex === 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                continue; // Retry loop
            } else {
                console.error(`AI Error: ${error.message} (Status: ${error.response?.status})`);
                return null; // Skip this image
            }
        }
    }
}

/**
 * Process a message to extract level and update roles
 * @param {Message} message - The Discord message object
 */
export async function processLevelScreenshot(message) {
    if (message.author.bot) return;
    if (message.attachments.size === 0) return;

    const enlistedRoleId = process.env.ENLISTED_ROLE_ID;
    const rpRoleId = process.env.RP_ROLE_ID;

    // Fetch the member object
    let member = message.member;
    if (!member) {
        try {
            member = await message.guild.members.fetch(message.author.id);
        } catch (err) {
            console.error(`Error fetching member for role check: ${err.message}`);
            return;
        }
    }
    if (!member) return;

    const isEnlisted = enlistedRoleId && member.roles.cache.has(enlistedRoleId);
    const isRP = rpRoleId && member.roles.cache.has(rpRoleId);

    // Only process job logs for Active/Enlisted or Reserved Personnel members
    if (!isEnlisted && !isRP) return;

    const targetImage = message.attachments.find(a => a.contentType && a.contentType.startsWith('image/'));
    if (!targetImage) return;

    // --- REACTIVATION FLOW: If user is RP and posts a job log, reactivate them ---
    if (isRP && !isEnlisted) {
        console.log(`[RP Reactivation] ${message.author.username} posted a job log while RP. Reactivating...`);
        try {
            // Remove RP role, add Enlisted role
            await member.roles.remove(rpRoleId);
            await member.roles.add(enlistedRoleId);

            // Fix nickname: remove [RP] prefix
            const currentNick = member.nickname || member.user.username;
            if (currentNick.startsWith('[RP]')) {
                const newNick = currentNick.replace(/^\[RP\]\s*/, '').trim();
                await member.setNickname(newNick || null).catch(e => console.error('[RP] Nickname reset failed:', e.message));
            }

            // Move embed entry: remove from RP embed, add to Enlisted embed
            const rpWebhookUrl = process.env.RP_WEBHOOK_URL;
            const rpMessageId = process.env.RP_EMBED_MESSAGE_ID;
            const enlistWebhookUrl = process.env.REGISTER_WEBHOOK_URL;
            const enlistMessageId = process.env.REGISTER_EMBED_MESSAGE_ID;

            // Fetch registration number from players table
            const { data: playerData } = await supabase
                .from('players')
                .select('registration_number')
                .eq('discord_id', message.author.id)
                .single();
            const regNum = playerData?.registration_number;

            if (rpWebhookUrl && rpMessageId) {
                await modifyRegistryComponents(rpWebhookUrl, rpMessageId, message.author.id, { action: 'remove' });
            }
            if (enlistWebhookUrl && enlistMessageId && regNum) {
                await modifyRegistryComponents(enlistWebhookUrl, enlistMessageId, message.author.id, { action: 'add', registrationNumber: regNum });
            }

            console.log(`[RP Reactivation] ${message.author.username} successfully reactivated.`);
        } catch (err) {
            console.error(`[RP Reactivation] Error for ${message.author.username}:`, err.message);
        }
    }

    // --- Update last_job_log_date in Supabase ---
    try {
        const { data: playerData } = await supabase
            .from('players')
            .select('id')
            .eq('discord_id', message.author.id)
            .single();

        if (playerData?.id) {
            await supabase
                .from('runs')
                .insert({ player_id: playerData.id, created_at: new Date().toISOString() });
        }
    } catch (err) {
        console.error(`[JobLog] Failed to record run for ${message.author.username}:`, err.message);
    }

    // Process Image
    const level = await extractLevelFromImage(targetImage.url);

    if (level !== null && typeof level === 'number') {
        const targetRoleConfig = LEVEL_ROLES.find(r => level >= r.min && level < r.max);

        if (targetRoleConfig) {
            try {
                let member = message.member;
                if (!member) {
                    member = await message.guild.members.fetch(message.author.id);
                }

                // Find user's current level role (from our managed list)
                const currentRoleConfig = LEVEL_ROLES.find(r => member.roles.cache.has(r.id));
                const currentMin = currentRoleConfig ? currentRoleConfig.min : 0;
                const targetMin = targetRoleConfig.min;

                // Logic: 
                // 1. If same range (targetMin === currentMin) -> Do nothing.
                // 2. If lower (targetMin < currentMin) -> Silent skip.
                // 3. If higher (targetMin > currentMin) -> Update.

                if (targetMin > currentMin) {
                    // Upgrade!

                    // Remove ALL managed roles to ensure clean state
                    const rolesToRemove = member.roles.cache.filter(r => ALL_ROLE_IDS.includes(r.id));
                    if (rolesToRemove.size > 0) {
                        await member.roles.remove(rolesToRemove);
                    }

                    // Add new role
                    await member.roles.add(targetRoleConfig.id);

                    // Logging
                    const removedRolesString = rolesToRemove.size > 0 ? rolesToRemove.map(r => r.name).join(', ') : "None";
                    const targetRole = message.guild.roles.cache.get(targetRoleConfig.id);
                    const assignedRoleString = targetRole ? targetRole.name : targetRoleConfig.id;
                    const date = message.createdAt.toISOString().replace('T', ' ').substring(0, 19);

                    console.log(`User : ${message.author.username} (${message.author.id})`);
                    console.log(`Level Extracted : ${level}`);
                    console.log(`Removed Roles : ${removedRolesString}`);
                    console.log(`New Assigned role : ${assignedRoleString}`);
                    console.log(`Date that ss was uploaded : ${date}`);
                    console.log('-----------------------------------');
                } else {
                    // Debug log (optional)
                    // console.log(`Skipping: Level ${level} (Role Min ${targetMin}) is not higher than current (Role Min ${currentMin})`);
                }

            } catch (err) {
                console.error(`Error updating roles for ${message.author.tag}: ${err.message}`);
            }
        }
    }
}
