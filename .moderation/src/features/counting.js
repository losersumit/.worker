
import { routeAiPrompt } from "../ai/promptRouter.js";
import {
  getCountingState,
  saveCountingState,
} from "../systems/storage.js";

import config from "../config/index.js";

const COUNTING_RESET_TEXT = "Starting again from 1";

async function askCountingAi(prompt, maxTokens = 120) {
  return routeAiPrompt({
    model: config.ai.model || "openai/gpt-oss-120b",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: maxTokens,
  });
}

/**
 * Deterministically resolves simple integers, basic arithmetic, and natural language
 * successor/predecessor phrases before calling AI.
 * Returns the resolved integer or null if complex AI evaluation is needed.
 */
export function tryDeterministicNumber(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  // 1. Plain integer (e.g. "1504", "+1504", "1504.0")
  if (/^[+-]?\d+(?:\.0+)?$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  // 2. Simple integer with punctuation or symbols (e.g. "1504!", "1504.", "#1504")
  const punctMatch = trimmed.match(/^[#]?\s*([+-]?\d+)\s*[.!?:)]*$/);
  if (punctMatch) {
    return Number.parseInt(punctMatch[1], 10);
  }

  // 3. Successor phrases (e.g. "number after 1503", "next number after 1503", "successor of 1503")
  const afterMatch =
    trimmed.match(/^(?:the\s+)?(?:next\s+)?(?:number\s+)?(?:after|following)\s+([+-]?\d+)$/i) ||
    trimmed.match(/^(?:the\s+)?successor(?:\s+of)?\s+([+-]?\d+)$/i) ||
    trimmed.match(/^(?:one\s+)?more\s+than\s+([+-]?\d+)$/i) ||
    trimmed.match(/^([+-]?\d+)\s+plus\s+one$/i);
  if (afterMatch) {
    return Number.parseInt(afterMatch[1], 10) + 1;
  }

  // 4. Predecessor phrases (e.g. "number before 1505", "predecessor of 1505", "one less than 1505")
  const beforeMatch =
    trimmed.match(/^(?:the\s+)?(?:previous\s+)?(?:number\s+)?before\s+([+-]?\d+)$/i) ||
    trimmed.match(/^(?:the\s+)?predecessor(?:\s+of)?\s+([+-]?\d+)$/i) ||
    trimmed.match(/^(?:one\s+)?less\s+than\s+([+-]?\d+)$/i) ||
    trimmed.match(/^([+-]?\d+)\s+minus\s+one$/i);
  if (beforeMatch) {
    return Number.parseInt(beforeMatch[1], 10) - 1;
  }

  // 5. Basic arithmetic like "1503 + 1", "1505 - 1", "752 * 2", "3008 / 2"
  const mathMatch = trimmed.match(/^([+-]?\d+)\s*([\+\-\*\/])\s*([+-]?\d+)$/);
  if (mathMatch) {
    const a = Number.parseInt(mathMatch[1], 10);
    const op = mathMatch[2];
    const b = Number.parseInt(mathMatch[3], 10);
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    if (op === "/" && b !== 0 && a % b === 0) return a / b;
  }

  return null;
}

export async function judgeCountingMessage(content, expected) {
  const prompt = `
You are an ultra-knowledgeable, dynamic judge for a counting game.
The expected number in the sequence is: ${expected}.
The user input is: "${content}".

The user input can be ANYTHING that can lead to or resolve to a number:
- General knowledge, history, dates, pop culture, trivia (e.g. "Hitler death year" -> 1945, "AB de Villiers jersey number" -> 17, "atomic number of Gold" -> 79, "year Titanic sank" -> 1912, "number of bones in adult human body" -> 206)
- Sports jersey numbers, records, titles, player numbers
- Natural language descriptions, sequences, successors, predecessors (e.g. "number after 1503" -> 1504, "next number after 1503" -> 1504, "successor of 1503" -> 1504, "number before 1505" -> 1504, "one more than 1503" -> 1504)
- Mathematical expressions using BODMAS rules (e.g. "1500+4", "1503+1", "2*752")
- Higher mathematics (e.g. "e^πi+1" for 0, "sin^2(x)+cos^2(x)" for 1), integrals, derivatives, physics constants
- Number words in any language (e.g. "one thousand five hundred four", "seventeen"), Roman numerals (e.g. "MDIV"), ASCII, hex
- Riddles, word puzzles, facts, or any creative hint leading to a number

Step 1: Identify what integer the user input resolves to. If there are multiple valid interpretations (e.g. a player wore multiple jersey numbers across teams/careers or an event has alternate conventions), check if any valid interpretation matches ${expected}.
Step 2: Compare that integer with ${expected}.

Format your response strictly as:
RESOLVED: <integer or UNKNOWN>
MATCH: YES (if it resolves to ${expected}) or NO (if it evaluates to a different number or is not a number)
`;

  try {
    const aiResponse = await askCountingAi(prompt, 120);
    const text =
      aiResponse?.choices?.[0]?.message?.content?.trim() || "";

    const match = text.match(/MATCH:\s*(YES|NO)/i);
    if (match) {
      return match[1].toUpperCase();
    }

    const resolvedMatch = text.match(/RESOLVED:\s*(-?\d+)/i);
    if (resolvedMatch) {
      const resolvedInt = Number.parseInt(resolvedMatch[1], 10);
      return resolvedInt === expected ? "YES" : "NO";
    }

    if (/\bYES\b/i.test(text)) return "YES";
    if (/\bNO\b/i.test(text)) return "NO";

    return text.toUpperCase();
  } catch (err) {
    console.error("[Counting] Error in judgeCountingMessage:", err);
    throw err;
  }
}

export async function extractCountFromContent(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const deterministic = tryDeterministicNumber(trimmed);
  if (Number.isInteger(deterministic)) {
    return deterministic;
  }

  const prompt = `
You are an ultra-knowledgeable counting-game evaluator.
The user input is: "${content}".

Determine what single integer number this message evaluates to, references, or describes.
It can be ANYTHING that leads to a number:
- General knowledge, history, dates, pop culture, trivia (e.g. "Hitler death year" -> 1945, "AB de Villiers jersey number" -> 17, "atomic number of Gold" -> 79, "year Titanic sank" -> 1912)
- Sports stats, jersey numbers, player numbers, championship years
- Natural language descriptions, sequences, successors, predecessors (e.g. "number after 1503" -> 1504, "successor of 1503" -> 1504, "number before 10" -> 9, "one more than 100" -> 101)
- Mathematical expressions, BODMAS rules, calculus, equations
- Number words in any language, Roman numerals, ASCII, binary, hex
- Riddles, word problems, science facts

Format your response strictly as:
RESOLVED: <integer or UNKNOWN>
`;

  const aiResponse = await askCountingAi(prompt, 60);
  const answer =
    aiResponse?.choices?.[0]?.message?.content?.trim() || "";

  const match = answer.match(/RESOLVED:\s*(-?\d+)/i);
  if (match) {
    return Number.parseInt(match[1], 10);
  }

  if (/UNKNOWN|INVALID/i.test(answer)) {
    return null;
  }

  const fallbackMatch = answer.match(/-?\d+$/m) || answer.match(/-?\d+/);
  return fallbackMatch ? Number.parseInt(fallbackMatch[0], 10) : null;
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
  const countingChannelId = config.channels.COUNTING;
  if (message.channel.id !== countingChannelId) return;

  const state = getCountingState();
  const expected = state.currentCount + 1;

  // 1. No user can count twice in a row
  if (message.author.id === state.lastUserId) {
    await message.react("❌");
    await message.reply(
      "You cannot count twice in a row! Wait for someone else.",
    );
    return;
  }

  // 2. Check deterministic numbers and common expressions first (saves AI latency & quota)
  const deterministicNum = tryDeterministicNumber(message.content);
  if (deterministicNum !== null) {
    if (deterministicNum === expected) {
      await message.react("✅");

      await saveCountingState({
        currentCount: expected,
        lastUserId: message.author.id,
      });

      return;
    } else {
      await message.react("❌");
      await message.reply(
        `Wrong value! The next number is **${expected}**. Try again!`,
      );

      return;
    }
  }

  // 3. AI evaluation for complex inputs
  try {
    const answer = await judgeCountingMessage(message.content, expected);

    if (answer.includes("YES")) {
      await message.react("✅");

      await saveCountingState({
        currentCount: expected,
        lastUserId: message.author.id,
      });
    } else {
      await message.react("❌");
      await message.reply(
        `Wrong value! The next number is **${expected}**. Try again!`,
      );
    }
  } catch (err) {
    console.error("Error in AI counting:", err);
  }
}
