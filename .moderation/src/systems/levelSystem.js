import axios from 'axios';
import crypto from 'crypto';
import '../utils/loadEnv.js';
import config from '../config.js';
import { supabase } from '../clients/supabase.js';
import { rebuildPersonnelEmbeds } from '../jobs/inactivityScanner.js';

// Configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Role Definitions
const LEVEL_ROLES = [
    { min: 100, max: Infinity, id: process.env.LEVEL_ROLE_ELITE        || '1469958213997821952' },
    { min: 75,  max: 100,      id: process.env.LEVEL_ROLE_SPECIALIST   || '1469958222420119715' },
    { min: 50,  max: 75,       id: process.env.LEVEL_ROLE_MASTER       || '1448029023530913946' },
    { min: 30,  max: 50,       id: process.env.LEVEL_ROLE_TACTICAL     || '1448029024948326472' },
    { min: 12,  max: 30,       id: process.env.LEVEL_ROLE_PROFESSIONAL || '1448029028970664088' },
    { min: 5,   max: 12,       id: process.env.LEVEL_ROLE_QUALIFIED    || '1448029030283477074' },
    { min: 1,   max: 5,        id: process.env.LEVEL_ROLE_ROOKIE       || '1469956018908823716' }
];

const ALL_ROLE_IDS = LEVEL_ROLES.map(r => r.id);

// Load API Keys
const keys = [
    process.env.GROQ_API_KEY_ONE,
    process.env.GROQ_API_KEY_TWO,
    process.env.GROQ_API_KEY_THREE,
    process.env.GROQ_API_KEY_FOUR
].filter(k => k);

if (keys.length === 0) {
    console.error('No Groq API keys found in .env');
}

// ─── Groq helper (rotates keys on 429) ───────────────────────────────────────

async function callGroqVision(prompt, imageUrl, maxRetries = 10) {
    let keyIndex = 0;
    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;
        const apiKey = keys[keyIndex];

        try {
            const response = await axios.post(GROQ_API_URL, {
                model: config.ai.visionModel,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imageUrl } }
                    ]
                }],
                response_format: { type: 'json_object' }
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type':  'application/json'
                },
                timeout: 30000
            });

            return response.data.choices[0].message.content;
        } catch (error) {
            if (error.response?.status === 429) {
                keyIndex = (keyIndex + 1) % keys.length;
                console.log(`[LevelSystem] Rate limit hit. Rotating to key index ${keyIndex}...`);
                await new Promise(r => setTimeout(r, keyIndex === 0 ? 2000 : 500));
                continue;
            }
            console.error(`[LevelSystem] Groq API error: ${error.message} (${error.response?.status})`);
            return null;
        }
    }
    return null;
}

// ─── Validation: is this a valid job completion screenshot? ──────────────────

/**
 * Asks the AI if the image is a valid job completion screen.
 * Returns true if valid, false otherwise.
 */
async function isValidJobCompletionScreen(imageUrl) {
    const prompt = `Look at this image carefully.
Is this a valid in-game job completion / delivery completion screenshot from Euro Truck Simulator 2 or American Truck Simulator?
A valid screenshot shows a job/delivery results screen with stats like income, distance, XP, or score.
Return JSON with a single key: {"valid": true} or {"valid": false}.
If you are unsure, return {"valid": false}.`;

    const raw = await callGroqVision(prompt, imageUrl);
    if (!raw) return false;

    try {
        const result = JSON.parse(raw);
        return result.valid === true;
    } catch {
        console.error('[LevelSystem] Failed to parse validity JSON:', raw);
        return false;
    }
}

// ─── Duplicate detection using image_hash (SHA-256) ──────────────────────────

/**
 * Downloads the image and computes a SHA-256 hash of the raw bytes.
 * This matches the hash format stored by UVS bot in the runs table.
 */
async function computeImageHash(imageUrl) {
    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 15000
        });
        const buffer = Buffer.from(response.data);
        return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch (err) {
        console.error('[LevelSystem] Failed to compute image hash:', err.message);
        return null;
    }
}

/**
 * Checks if the given hash already exists in the runs table.
 * Returns true if it's a duplicate (already processed by UVS bot).
 */
async function isDuplicateImage(imageHash) {
    if (!imageHash) return false;
    const { data, error } = await supabase
        .from('runs')
        .select('id')
        .eq('image_hash', imageHash)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[LevelSystem] Error checking duplicate image hash:', error.message);
        return false; // Fail open — don't block on DB error
    }
    return data !== null;
}

// ─── Level extraction ─────────────────────────────────────────────────────────

async function extractLevelFromImage(imageUrl) {
    const prompt = `Analyze this image.
There are two big numbers on either side of a green bar. The number on the left is the current level, and the number on the right is the next level.
Return JSON with a single key "level" containing the number on the left as an integer.
If you cannot clearly see the numbers or if there is no level bar, return {"level": null}.`;

    const raw = await callGroqVision(prompt, imageUrl);
    if (!raw) return null;

    try {
        const result = JSON.parse(raw);
        return result.level;
    } catch {
        console.error('[LevelSystem] Failed to parse level JSON:', raw);
        return null;
    }
}

// ─── RP → AP reactivation ────────────────────────────────────────────────────

async function reactivateReservedMember(message, member, enlistedRoleId, rpRoleId) {
    const isEnlisted = enlistedRoleId && member.roles.cache.has(enlistedRoleId);
    const isRP       = rpRoleId       && member.roles.cache.has(rpRoleId);

    if (!isRP) return false;

    console.log(`[RP Reactivation] ${message.author.username} posted valid job log while RP. Reactivating...`);

    const apRoleId = process.env.AP_ROLE_ID || '1448029015947346042';

    await member.roles.remove(rpRoleId);
    await member.roles.add(enlistedRoleId);
    await member.roles.add(apRoleId);

    const currentNick = member.nickname || member.user.username;
    if (currentNick.startsWith('[RP]')) {
        const newNick = currentNick.replace(/^\[RP\]\s*/, '').trim();
        await member.setNickname(newNick || null).catch(e =>
            console.error('[RP] Nickname reset failed:', e.message)
        );
    }

    await supabase
        .from('enlisted_drivers')
        .update({ status: 'AP' })
        .eq('discord_id', message.author.id);

    await rebuildPersonnelEmbeds(message.client, supabase);
    console.log(`[RP Reactivation] ${message.author.username} successfully reactivated to AP. Embeds rebuilt.`);

    return true;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Process a message in the job-logs channel.
 *
 * Gate order:
 *   1. Must have an image attachment.
 *   2. AI must confirm it is a valid job completion screenshot.
 *   3. Image hash must NOT already exist in the runs table (no duplicates).
 *   4. If user is RP (and not RTD) → reactivate to AP.
 *   5. Extract level and upgrade level role if higher.
 *
 * @param {import('discord.js').Message} message
 */
export async function processLevelScreenshot(message) {
    if (message.author.bot) return;

    const enlistedRoleId = process.env.ENLISTED_ROLE_ID;
    const rpRoleId       = process.env.RP_ROLE_ID;
    const rtdRoleId      = process.env.RTD_ROLE_ID || '1499413282279129139';

    // Fetch member
    let member = message.member;
    if (!member) {
        try {
            member = await message.guild.members.fetch(message.author.id);
        } catch (err) {
            console.error(`[LevelSystem] Error fetching member: ${err.message}`);
            return;
        }
    }
    if (!member) return;

    const isEnlisted = enlistedRoleId && member.roles.cache.has(enlistedRoleId);
    const isRP       = rpRoleId       && member.roles.cache.has(rpRoleId);
    const isRTD      = member.roles.cache.has(rtdRoleId);

    // Only process for Active/Enlisted or Reserved Personnel — skip RTD entirely
    if (!isEnlisted && !isRP) return;
    if (isRTD) {
        // RTD members are never reactivated and do not get level roles from job logs
        console.log(`[LevelSystem] Skipping RTD member ${message.author.username}.`);
        return;
    }

    // ── Gate 1: Must have an image ────────────────────────────────────────
    const targetImage = message.attachments.find(
        a => a.contentType && a.contentType.startsWith('image/')
    );
    if (!targetImage) {
        // No image → not a job log post. Skip everything (including RP→AP).
        console.log(`[LevelSystem] No image in job-log post by ${message.author.username}. Skipping.`);
        return;
    }

    // ── Gate 2: AI validation ─────────────────────────────────────────────
    console.log(`[LevelSystem] Validating screenshot from ${message.author.username}...`);
    const isValid = await isValidJobCompletionScreen(targetImage.url);
    if (!isValid) {
        console.log(`[LevelSystem] Screenshot rejected (not a valid job completion) from ${message.author.username}.`);
        return;
    }

    // ── Gate 3: Duplicate hash check ──────────────────────────────────────
    const imageHash = await computeImageHash(targetImage.url);
    const isDuplicate = await isDuplicateImage(imageHash);
    if (isDuplicate) {
        console.log(`[LevelSystem] Duplicate image detected from ${message.author.username}. Hash: ${imageHash}. Skipping.`);
        return;
    }

    // ── All gates passed ──────────────────────────────────────────────────

    // RP → AP reactivation (only if user is RP and not RTD)
    if (isRP && !isRTD) {
        try {
            await reactivateReservedMember(message, member, enlistedRoleId, rpRoleId);
            member = await message.guild.members.fetch(message.author.id).catch(() => member);
        } catch (err) {
            console.error(`[RP Reactivation] Error for ${message.author.username}:`, err.message);
        }
    }

    // ── Level extraction & role upgrade ──────────────────────────────────
    const level = await extractLevelFromImage(targetImage.url);

    if (level !== null && typeof level === 'number') {
        const targetRoleConfig = LEVEL_ROLES.find(r => level >= r.min && level < r.max);

        if (targetRoleConfig) {
            try {
                // Re-fetch member after potential role changes
                const freshMember = await message.guild.members.fetch(message.author.id).catch(() => member);

                const currentRoleConfig = LEVEL_ROLES.find(r => freshMember.roles.cache.has(r.id));
                const currentMin        = currentRoleConfig ? currentRoleConfig.min : 0;
                const targetMin         = targetRoleConfig.min;

                if (targetMin > currentMin) {
                    // Remove all managed level roles
                    const rolesToRemove = freshMember.roles.cache.filter(r => ALL_ROLE_IDS.includes(r.id));
                    if (rolesToRemove.size > 0) {
                        await freshMember.roles.remove(rolesToRemove);
                    }

                    // Add new level role
                    await freshMember.roles.add(targetRoleConfig.id);

                    const removedNames    = rolesToRemove.size > 0 ? rolesToRemove.map(r => r.name).join(', ') : 'None';
                    const targetRole      = message.guild.roles.cache.get(targetRoleConfig.id);
                    const assignedName    = targetRole ? targetRole.name : targetRoleConfig.id;
                    const date            = message.createdAt.toISOString().replace('T', ' ').substring(0, 19);

                    console.log(`User               : ${message.author.username} (${message.author.id})`);
                    console.log(`Level Extracted    : ${level}`);
                    console.log(`Removed Roles      : ${removedNames}`);
                    console.log(`New Assigned Role  : ${assignedName}`);
                    console.log(`Screenshot Date    : ${date}`);
                    console.log('-----------------------------------');
                }
            } catch (err) {
                console.error(`[LevelSystem] Error updating roles for ${message.author.tag}: ${err.message}`);
            }
        }
    }
}
