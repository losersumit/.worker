import "../utils/loadEnv.js";
import axios from "axios";
import config from "../config.js";

export const api_key_one = process.env.GEMINI_API_KEY_ONE || "";
export const api_key_two = process.env.GEMINI_API_KEY_TWO || "";
export const api_key_three = process.env.GEMINI_API_KEY_THREE || "";
export const api_key_four = process.env.GEMINI_API_KEY_FOUR || "";
export const api_key_five = process.env.GEMINI_API_KEY_FIVE || "";
export const api_key_six = process.env.GEMINI_API_KEY_SIX || "";
export const api_key_seven = process.env.GEMINI_API_KEY_SEVEN || "";
export const api_key_eight = process.env.GEMINI_API_KEY_EIGHT || "";

const GEMINI_ENDPOINT =
  process.env.GEMINI_ENDPOINT ||
  "https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions";

const rawKeys = [
  api_key_one,
  api_key_two,
  api_key_three,
  api_key_four,
  api_key_five,
  api_key_six,
  api_key_seven,
  api_key_eight,
].filter((k) => k);

// Represent key list with processing states
const keys = rawKeys.map((key, index) => ({
  key,
  index,
  isProcessing: false,
}));

const waiterQueue = [];

function normalizeErrorMessage(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const code = data?.error?.code || data?.error?.type || "";
  const message = data?.error?.message || err?.message || "";
  return { status, code: String(code), message: String(message) };
}

function isQuotaOrTokenExhaustion(err) {
  const { status, code, message } = normalizeErrorMessage(err);
  const haystack = `${code} ${message}`.toLowerCase();

  const looksLikeQuota =
    haystack.includes("insufficient_quota") ||
    haystack.includes("quota") ||
    haystack.includes("exceeded") ||
    haystack.includes("token") ||
    haystack.includes("billing") ||
    haystack.includes("credits") ||
    haystack.includes("rate limit") ||
    status === 401 ||
    status === 403;

  return (
    (status === 429 || status === 402 || status === 401 || status === 403) &&
    looksLikeQuota
  );
}

async function postWithKey(payload, apiKey) {
  // Use visionModel from config; fall back to fallbackVisionModel if needed
  const modelToUse = payload.model || config.ai.visionModel || config.ai.fallbackVisionModel || "gemini-1.5-flash";
  const finalPayload = {
    ...payload,
    model: modelToUse,
  };

  const res = await axios.post(GEMINI_ENDPOINT, finalPayload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 30000,
  });
  return res.data;
}

/**
 * Acquires an available and free key that hasn't been tried for the current request.
 * If none are free, returns a promise that resolves when one becomes free.
 * @param {Set<number>} triedKeyIndices
 * @returns {Promise<Object>}
 */
async function acquireFreeKey(triedKeyIndices) {
  // Find a key that is free and not tried yet
  const keyObj = keys.find((k) => !k.isProcessing && !triedKeyIndices.has(k.index));
  if (keyObj) {
    keyObj.isProcessing = true;
    return keyObj;
  }

  // Wait until an untried key is released
  return new Promise((resolve) => {
    waiterQueue.push({
      triedKeyIndices,
      resolve: (selectedKey) => {
        selectedKey.isProcessing = true;
        resolve(selectedKey);
      },
    });
  });
}

/**
 * Releases a key, marking it as not processing and handing it over to the first matching waiter in the queue.
 * @param {Object} keyObj
 */
function releaseKey(keyObj) {
  keyObj.isProcessing = false;

  // Find a waiter that hasn't tried this key yet
  const waiterIndex = waiterQueue.findIndex((w) => !w.triedKeyIndices.has(keyObj.index));
  if (waiterIndex !== -1) {
    const waiter = waiterQueue.splice(waiterIndex, 1)[0];
    waiter.resolve(keyObj);
  }
}

async function resolveImageUrls(payload) {
  if (!payload || !payload.messages) return payload;

  const newMessages = [];
  for (const message of payload.messages) {
    if (!message || !message.content) {
      newMessages.push(message);
      continue;
    }

    if (Array.isArray(message.content)) {
      const newContent = [];
      for (const item of message.content) {
        if (item && item.type === "image_url" && item.image_url && typeof item.image_url.url === "string") {
          const url = item.image_url.url;
          if (url.startsWith("http://") || url.startsWith("https://")) {
            try {
              console.log(`[GeminiClient] Automatically resolving remote image URL to base64: ${url.substring(0, 80)}...`);
              const imageRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
              const contentType = imageRes.headers['content-type'] || 'image/jpeg';
              const base64Image = Buffer.from(imageRes.data).toString('base64');
              const dataUri = `data:${contentType};base64,${base64Image}`;
              
              newContent.push({
                ...item,
                image_url: {
                  ...item.image_url,
                  url: dataUri
                }
              });
              continue;
            } catch (err) {
              console.error(`[GeminiClient] Failed to resolve image URL to base64: ${url}. Error: ${err.message}`);
            }
          }
        }
        newContent.push(item);
      }
      newMessages.push({ ...message, content: newContent });
    } else {
      newMessages.push(message);
    }
  }

  return { ...payload, messages: newMessages };
}

/**
 * Call Gemini Chat Completions with automatic concurrency-aware key routing and failover.
 * Only forwards to free/available keys that aren't processing other requests.
 * 
 * @param {Object} payload - Chat completion request payload (model parameter is auto-mapped to Gemini model)
 * @returns {Promise<Object>} API response
 */
export async function geminiChatCompletion(payload) {
  if (keys.length === 0) {
    console.error("[GeminiClient] No API keys found!");
    throw new Error(
      "Missing Gemini API key(s). Set GEMINI_API_KEY_ONE (and optionally others).",
    );
  }

  // Preprocess payload to convert external image URLs to base64 data URIs
  const processedPayload = await resolveImageUrls(payload);

  let attempts = 0;
  const maxAttempts = keys.length;
  const triedKeyIndices = new Set();

  while (attempts < maxAttempts) {
    const keyObj = await acquireFreeKey(triedKeyIndices);
    triedKeyIndices.add(keyObj.index);
    attempts++;

    try {
      console.log(
        `[GeminiClient] Attempting request using key index ${keyObj.index} (Processing status: busy)...`,
      );
      const result = await postWithKey(processedPayload, keyObj.key);
      console.log(
        `[GeminiClient] Request successful using key index ${keyObj.index}.`,
      );
      releaseKey(keyObj);
      return result;
    } catch (err) {
      console.error(
        `[GeminiClient] Request failed using key index ${keyObj.index}.`,
      );
      releaseKey(keyObj);

      if (attempts >= maxAttempts) {
        console.error(
          "[GeminiClient] All available keys were tried and failed for this request.",
        );
        throw err;
      }

      console.warn(
        `[GeminiClient] Key index ${keyObj.index} failed. Retrying request with another available and free key...`,
      );
    }
  }
}
