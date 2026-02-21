import { getCountingState, saveCountingState } from '../systems/storage.js';
import { groqChatCompletion } from '../clients/groq.js';
import config from '../config.js';

/**
 * Handles messages in the counting channel
 * @param {Message} message - The Discord message object
 */
export async function handleCounting(message) {
    const countingChannelId = process.env.COUNTING_CHANNEL_ID;
    if (message.channel.id !== countingChannelId) return;

    const state = getCountingState();
    const expected = state.currentCount + 1;

    // 1. No user can count twice in a row
    if (message.author.id === state.lastUserId) {
        await message.react('❌');
        // Optional: Delete the message to keep channel clean?
        // await message.delete(); 
        await message.reply("You cannot count twice in a row! Wait for someone else.");
        return;
    }

    // 2. Optimization: Check if it's a simple number first to save AI calls
    const simpleNum = parseFloat(message.content);
    if (!isNaN(simpleNum) && Math.abs(simpleNum - expected) < 0.001) {
        await message.react('✅');
        await saveCountingState({
            currentCount: expected,
            lastUserId: message.author.id
        });
        return;
    }

    // 3. AI Evaluation for complex inputs
    // "Is this text equal to expected?"
    try {
        // Use the configured chat model
        const model = config.ai.model;

        const prompt = `
    You are a math judge for a counting game.
    The expected number is: ${expected}.
    The user input is: "${message.content}".
    
    Does the user input represent the expected number?
    - Accept mathematical expressions (e.g. "2+2" for 4, "sin^2(x)+cos^2(x)" for 1).
    - Accept riddles or word problems if they clearly resolve to the number.
    - Accept number words (e.g. "five").
    
    Reply strictly with "YES" if it evaluates to ${expected}.
    Reply strictly with "NO" if it evaluates to a different number.
    Reply strictly with "CHAT" if it is just text/chat and not an attempt to count.
    `;

        const aiResponse = await groqChatCompletion({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: 10
        });

        const answer = aiResponse?.choices?.[0]?.message?.content?.trim().toUpperCase() || "NO";

        if (answer.includes("YES")) {
            await message.react('✅');
            await saveCountingState({
                currentCount: expected,
                lastUserId: message.author.id
            });
        } else if (answer.includes("NO")) {
            await message.react('❌');
            await message.reply(`Wrong value! The next number is **${expected}**. Try again!`);
            // DO NOT RESET COUNT
        } else {
            // "CHAT" or unsure - Ignore or react with a question mark?
            // User said "counting should never ever break". 
            // If it's chat, we just let it be.
        }

    } catch (err) {
        console.error("Error in AI counting:", err);
        // Fallback: If AI fails, maybe standard check? Or just ignore?
        // Let's ignore to prevent breaking streak on API error.
    }
}
