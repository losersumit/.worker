import { Chunker } from './rag/chunker.js';
import { embedText, sha256 } from './rag/embed.js';
import { supabase } from './db/db.js';
import { retrieveContext } from './rag/retrieve.js';
import { buildPrompt } from './ai/promptBuilder.js';
import { generateReply } from './ai/generateReply.js';
import { checkRateLimit, getConversationHistory, appendConversationHistory } from './rag/stateManager.js';

const chunker = new Chunker();

async function saveChunk(chunk) {
    const hash = sha256(`${chunk.channel_id}|${chunk.start_time}|${chunk.end_time}|${chunk.text}`);

    const { data: existing } = await supabase
        .from('chunks')
        .select('chunk_id')
        .eq('content_hash', hash)
        .limit(1);

    if (existing && existing.length) return;

    const embedding = await embedText(chunk.text);
    if (!embedding) return;

    const { error } = await supabase
        .from('chunks')
        .insert({
            channel_id: chunk.channel_id,
            start_time: chunk.start_time,
            end_time: chunk.end_time,
            text: chunk.text,
            content_hash: hash,
            embedding: `[${embedding.join(',')}]`
        });

    if (error && error.code !== '23505') {
        console.error('Error saving chunk:', error);
    }
}

export async function handleDiscordMessageIngestion(stored, message) {
    if (!stored) return;

    // Save to rolling chunk
    const chunk = chunker.addMessage(stored);
    if (chunk) await saveChunk(chunk);

    // Flush stale chunks
    for (const staleChunk of chunker.flushStale()) {
        await saveChunk(staleChunk);
    }

    // ─── AMBIENT REPLY PIPELINE ───
    const isBotPing = message.mentions.has(message.client.user);
    const contentWithoutPings = message.content.replace(/<@!?[0-9]+>/g, '').trim();

    // Only respond if the user directly pings the bot
    if (!isBotPing || !contentWithoutPings) return;

    // Check rate limit using remote Supabase DB
    const isLimited = await checkRateLimit(message.author.id);
    if (isLimited) {
        // Silently ignore or politely decline if we want to be nice
        return;
    }

    try {
        message.channel.sendTyping();

        // 1. Retrieve RAG Context (Hybrid Search capable via RPC)
        const context = await retrieveContext(contentWithoutPings, {
            channelId: message.channel.id,
            hours: 72,
            limit: 5
        });

        // 2. Load recent conversation history with this specific user
        const convoHistory = await getConversationHistory(message.author.id);

        // 3. Prepare the prompt to Groq, appending context and history
        let systemPrompt = `You are a helpful and highly knowledgeable Discord server member. You act like a human assistant.\n\n`;

        if (context && context.length > 0) {
            systemPrompt += `Here is relevant history from the server that might help answer the user:\n`;
            systemPrompt += context.map((c, i) => `[Fact ${i + 1}] ${c.text.slice(0, 300)}`).join('\n') + `\n\n`;
        }

        let fullPrompt = systemPrompt + `Conversation History:\n`;
        convoHistory.forEach(msg => {
            fullPrompt += `${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}\n`;
        });

        fullPrompt += `User: ${contentWithoutPings}\nYou: `;

        // 4. Generate the reply
        const answer = await generateReply(fullPrompt);

        // 5. Save the new context to state
        await appendConversationHistory(message.author.id, contentWithoutPings, answer);

        await message.reply(answer);

    } catch (err) {
        console.error("Ambient reply generation failed:", err);
    }
}
