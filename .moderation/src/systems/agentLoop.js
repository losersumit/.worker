/**
 * Agent Loop — The Core Brain
 * Sends user messages to Groq with tool definitions loaded.
 * Handles tool calls, clarification pauses, and preview confirmations.
 * Max 4 rounds per invocation to prevent infinite cycles.
 */

import { groqChatCompletion } from '../clients/groq.js';
import { buildContextPacket } from './contextBuilder.js';
import { getCapabilityMenu, loadAllTools } from './capabilityLoader.js';
import { createSession, getSession, updateSession, clearSession, STATES } from './taskSession.js';
import { extractAndSaveMemories } from './memory.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import config from '../config.js';

const MAX_ROUNDS = 4;
const AGENT_TEMPERATURE = Number(process.env.CHAT_TEMPERATURE || 0.7);
const AGENT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 512);

// ─── System Prompt ──────────────────────────────────────────────────

function buildSystemPrompt(capabilityMenu) {
    return `You are Worker, a casual chatbot and support provider in National Mobility Command [NMC], a Virtual Trucking Company for Truckers of Europe 3 [TOE3].

Tone:
- Human, brief, natural.
- Dry humor / deadpan is fine.
- No corporate style, no "As an AI" wording.
- Do Not mention anything like "I am support provider." You are a human who knows everything.
- Usually 1-3 sentences unless user asked for detail.
- If context is missing, say so plainly.
- You are also allowed to chat casually and non server related things.

${capabilityMenu}

RULES:
- If you need data or capabilities to answer, call the appropriate tools.
- For casual chat (greetings, jokes, general conversation), reply directly without tools.
- You can call multiple tools in parallel if you need data from different sources.
- When a user asks about another person via a reply, the referenced user's info is in the context below.
- For announcements or embeds, ALWAYS use preview_announcement first so the user can confirm before sending.
- If critical info is missing for a task (e.g. which channel), use ask_clarification to ask.`;
}

// ─── User Context Message ───────────────────────────────────────────

function buildUserMessage(ctx, rawContent) {
    let msg = `User: ${ctx.username} (ID: ${ctx.userId})\n`;
    msg += `Roles: ${ctx.userRoles.join(', ') || 'none'}\n`;
    msg += `Channel: #${ctx.channelName}\n`;

    if (ctx.isReply && ctx.referencedMessage) {
        msg += `Replying to ${ctx.referencedMessage.authorName} (ID: ${ctx.referencedMessage.authorId}) who said: "${ctx.referencedMessage.content}"\n`;
    }

    msg += `\nMessage: ${rawContent || ctx.content}`;
    return msg;
}

// ─── Preview Embed Builder ──────────────────────────────────────────

function buildPreviewEmbed(previewData, ctx) {
    const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setTitle('📋 PREVIEW — Not sent yet')
        .addFields(
            { name: 'Title', value: previewData.embedData.title || 'Untitled', inline: false },
            { name: 'Description', value: previewData.embedData.description || 'No description', inline: false },
            { name: 'Target Channel', value: `#${previewData.channelName}`, inline: true },
        );

    if (previewData.pingMention) {
        embed.addFields({ name: 'Will Ping', value: previewData.pingMention, inline: true });
    }

    if (previewData.webhookName) {
        embed.addFields({ name: 'Via Webhook', value: previewData.webhookName, inline: true });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`agent_confirm:${ctx.userId}:${ctx.channelId}`)
            .setLabel('✅ Confirm')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`agent_cancel:${ctx.userId}:${ctx.channelId}`)
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row] };
}

// ─── Main Agent Loop ────────────────────────────────────────────────

/**
 * Run the agent loop for a given message.
 * @param {import('discord.js').Message} message - The Discord message
 * @param {import('discord.js').Client} client - The bot client
 * @param {string|null} [clarificationReply=null] - Reply text when resuming from AWAITING_CLARIFICATION
 */
export async function runAgentLoop(message, client, clarificationReply = null) {
    const ctx = buildContextPacket(message, client);
    const supabase = client.supabase;

    // Build execution context for tools
    const toolContext = {
        client,
        supabase,
        message,
        guild: message.guild,
        member: message.member,
        userId: ctx.userId,
        channelId: ctx.channelId,
    };

    // Load all tool definitions upfront
    const { definitions, executors } = await loadAllTools();

    // Build messages array
    const systemPrompt = buildSystemPrompt(getCapabilityMenu());
    let messages;

    // Check if we're resuming from a clarification
    const existingSession = getSession(ctx.userId, ctx.channelId);
    if (clarificationReply && existingSession && existingSession.state === STATES.AWAITING_CLARIFICATION) {
        // Resume: use the stored conversation + the user's reply
        messages = [
            ...existingSession.agentMessages,
            { role: 'user', content: `User replied to clarification: ${clarificationReply}` },
        ];
        // Update session state back to RUNNING
        updateSession(ctx.userId, ctx.channelId, { state: STATES.RUNNING });
    } else {
        // Fresh start
        const userMsg = buildUserMessage(ctx, null);

        // Handle image messages with vision model
        let userContent;
        if (ctx.hasImage && ctx.imageUrl) {
            userContent = [
                { type: 'text', text: userMsg },
                { type: 'image_url', image_url: { url: ctx.imageUrl } },
            ];
        } else {
            userContent = userMsg;
        }

        messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ];
    }

    // Choose model (vision model for images)
    const modelToUse = (ctx.hasImage && ctx.imageUrl)
        ? (config.ai.visionModel || config.ai.fallbackVisionModel)
        : config.ai.model;

    // ─── The Loop ───────────────────────────────────────────────────
    for (let round = 0; round < MAX_ROUNDS; round++) {
        console.log(`[AgentLoop] Round ${round + 1}/${MAX_ROUNDS} for ${ctx.username} in #${ctx.channelName}`);

        try {
            await message.channel.sendTyping();
        } catch { /* ignore typing failures */ }

        const payload = {
            model: modelToUse,
            messages,
            temperature: AGENT_TEMPERATURE,
            max_tokens: AGENT_MAX_TOKENS,
            tools: definitions.length > 0 ? definitions : undefined,
            tool_choice: definitions.length > 0 ? 'auto' : undefined,
        };

        const response = await groqChatCompletion(payload);
        const choice = response?.choices?.[0];
        if (!choice) {
            await message.reply('Something went wrong. Try again.').catch(() => {});
            return;
        }

        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        // ─── No tool calls → Final text reply ───────────────────────
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            const reply = assistantMessage.content?.trim() || 'No response generated.';
            await message.reply(reply).catch(() => {});

            // Fire-and-forget: extract and save memories from this conversation
            if (supabase) {
                const convoHistory = messages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({
                        role: m.role,
                        name: m.role === 'assistant' ? 'Worker' : ctx.username,
                        text: typeof m.content === 'string' ? m.content : '[complex content]',
                    }));
                extractAndSaveMemories(supabase, ctx.userId, ctx.username, convoHistory).catch(err =>
                    console.error('[AgentLoop] Memory extraction error:', err.message),
                );
            }

            // Clear any active session
            clearSession(ctx.userId, ctx.channelId);
            return;
        }

        // ─── Execute tool calls ─────────────────────────────────────
        const toolResults = [];
        let specialAction = null;

        for (const tc of assistantMessage.tool_calls) {
            const fnName = tc.function.name;
            const fnArgs = JSON.parse(tc.function.arguments || '{}');

            console.log(`[AgentLoop] Tool call: ${fnName}(${JSON.stringify(fnArgs)})`);

            const executor = executors[fnName];
            if (!executor) {
                toolResults.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify({ error: `Unknown tool: ${fnName}` }),
                });
                continue;
            }

            const result = await executor(fnName, fnArgs, toolContext);

            // Check for special actions (clarification / preview)
            if (result?.__action === 'clarification') {
                specialAction = { type: 'clarification', data: result };
                toolResults.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify({ status: 'clarification_sent', question: result.question }),
                });
            } else if (result?.__action === 'preview') {
                specialAction = { type: 'preview', data: result };
                toolResults.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify({ status: 'preview_sent', channel: result.channelName }),
                });
            } else {
                toolResults.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: JSON.stringify(result),
                });
            }
        }

        // ─── Handle special actions ─────────────────────────────────
        if (specialAction) {
            if (specialAction.type === 'clarification') {
                // Pause the loop and ask the user
                const session = createSession(ctx.userId, ctx.channelId);
                messages.push(...toolResults);
                updateSession(ctx.userId, ctx.channelId, {
                    state: STATES.AWAITING_CLARIFICATION,
                    agentMessages: messages,
                });
                await message.reply(specialAction.data.question).catch(() => {});
                console.log(`[AgentLoop] Paused for clarification: "${specialAction.data.question}"`);
                return;
            }

            if (specialAction.type === 'preview') {
                // Send preview embed with Confirm/Cancel buttons
                const session = createSession(ctx.userId, ctx.channelId);
                updateSession(ctx.userId, ctx.channelId, {
                    state: STATES.AWAITING_CONFIRMATION,
                    pendingAction: {
                        embedData: specialAction.data.embedData,
                        targetChannelId: specialAction.data.targetChannelId,
                        channelName: specialAction.data.channelName,
                        pingMention: specialAction.data.pingMention,
                        webhookName: specialAction.data.webhookName,
                    },
                });

                const previewPayload = buildPreviewEmbed(specialAction.data, ctx);
                await message.reply(previewPayload).catch(() => {});
                console.log(`[AgentLoop] Preview sent for #${specialAction.data.channelName}`);
                return;
            }
        }

        // Add tool results to messages for the next round
        messages.push(...toolResults);
    }

    // If we exhausted all rounds without a final answer
    await message.reply('I ran into a loop trying to figure this out. Can you rephrase?').catch(() => {});
    clearSession(ctx.userId, ctx.channelId);
}
