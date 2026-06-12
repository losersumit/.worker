import { getCountingState, saveCountingState } from "../systems/storage.js";
import { groqChatCompletion } from "../clients/groq.js";
import config from "../config.js";

const COUNTING_RESET_TEXT = "Starting again from 1";

async function askCountingAi(prompt, maxTokens = 10) {
  return groqChatCompletion({
    model: config.ai.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: maxTokens,
  });
}

export async function judgeCountingMessage(content, expected) {
  const prompt = `
You are a math judge for a counting game.
The expected number is: ${expected}.
The user input is: "${content}".

Does the user input represent the expected number?
- Accept mathematical expressions (e.g. "2+2" for 4, "sin^2(x)+cos^2(x)" for 1).
- Accept riddles or word problems if they clearly resolve to the number.
- Accept number words (e.g. "five").

If it is complex mathematical expression, solve it using BODMAS rules.
It can also be higher mathematics (e.g. "e^πi+1" for 0). or integral or derivatives. Simplify them.
The number can also be related to normal general knowlege.

Reply strictly with "YES" if it evaluates to ${expected}.
Reply strictly with "NO" if it evaluates to a different number.
Reply strictly with "CHAT" if it is just text/chat and not an attempt to count.
`;

  const aiResponse = await askCountingAi(prompt);
  return (
    aiResponse?.choices?.[0]?.message?.content?.trim().toUpperCase() || "NO"
  );
}

export async function extractCountFromContent(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (/^[+-]?\d+(?:\.0+)?$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const prompt = `
You are extracting the intended counting-game number from a message.
Message: "${content}"

Return strictly one of these formats:
- an integer like 554 if the message clearly represents exactly one count number
- CHAT if it is chatter or does not represent a count
- INVALID if it looks like a counting attempt but you cannot confidently resolve it to one integer

If it is complex mathematical expression, solve it using BODMAS rules.
It can also be higher mathematics (e.g. "e^πi+1" for 0). or integral or derivatives. Simplify them.
The number can also be related to normal general knowlege.
Accept mathematical expressions, riddles, and number words when they clearly resolve to one integer.
`;

  const aiResponse = await askCountingAi(prompt, 20);
  const answer =
    aiResponse?.choices?.[0]?.message?.content?.trim().toUpperCase() ||
    "INVALID";

  if (answer === "CHAT" || answer === "INVALID") {
    return null;
  }

  const matchedInteger = answer.match(/-?\d+/);
  return matchedInteger ? Number.parseInt(matchedInteger[0], 10) : null;
}

export async function recoverCountingState(channel) {
  let before;

  while (true) {
    const messages = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (messages.size === 0) return null;

    for (const message of messages.values()) {
      if (
        message.author?.bot &&
        message.content.includes(COUNTING_RESET_TEXT)
      ) {
        return {
          currentCount: 0,
          lastUserId: null,
          sourceMessage: message,
          reason: "reset",
        };
      }

      const extractedCount = await extractCountFromContent(message.content);
      if (Number.isInteger(extractedCount)) {
        return {
          currentCount: extractedCount,
          lastUserId: message.author?.bot ? null : message.author.id,
          sourceMessage: message,
          reason: "count",
        };
      }
    }

    before = messages.last()?.id;
    if (!before) return null;
  }
}

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
    await message.react("❌");
    // Optional: Delete the message to keep channel clean?
    // await message.delete();
    await message.reply(
      "You cannot count twice in a row! Wait for someone else.",
    );
    return;
  }

  // 2. Optimization: Check if it's a simple number first to save AI calls
  const simpleNum = parseFloat(message.content);
  if (!isNaN(simpleNum) && Math.abs(simpleNum - expected) < 0.001) {
    await message.react("✅");
    await saveCountingState({
      currentCount: expected,
      lastUserId: message.author.id,
    });
    return;
  }

  // 3. AI Evaluation for complex inputs
  try {
    const answer = await judgeCountingMessage(message.content, expected);

    if (answer.includes("YES")) {
      await message.react("✅");
      await saveCountingState({
        currentCount: expected,
        lastUserId: message.author.id,
      });
    } else if (answer.includes("NO")) {
      await message.react("❌");
      await message.reply(
        `Wrong value! The next number is **${expected}**. Try again!`,
      );
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
