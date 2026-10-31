import "../utils/loadEnv.js";
import axios from "axios";
import config from "../config.js";

const envKeys = [
  process.env.GEMINI_API_KEY_ONE,
  process.env.GEMINI_API_KEY_TWO,
  process.env.GEMINI_API_KEY_THREE,
  process.env.GEMINI_API_KEY_FOUR,
  process.env.GEMINI_API_KEY_FIVE,
  process.env.GEMINI_API_KEY_SIX,
  process.env.GEMINI_API_KEY_SEVEN,
  process.env.GEMINI_API_KEY_EIGHT,
].filter((key) => typeof key === "string" && key.trim());

const GEMINI_ENDPOINT =
  process.env.GEMINI_ENDPOINT ||
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function getErrorDetails(err) {
  return {
    status: err?.response?.status,
    code: String(err?.response?.data?.error?.code || err?.response?.data?.error?.status || ""),
    message: String(err?.response?.data?.error?.message || err?.message || ""),
  };
}

function isCredentialError(err) {
  const { status, code, message } = getErrorDetails(err);
  return status === 401 || status === 403 ||
    /api key not valid|invalid api key|unauthenticated|permission denied/i.test(`${code} ${message}`);
}

function isRetryableKeyError(err) {
  const { status, code, message } = getErrorDetails(err);
  const text = `${code} ${message}`.toLowerCase();
  return status === 429 || status === 402 ||
    text.includes("quota") || text.includes("rate limit") ||
    text.includes("resource_exhausted") || text.includes("billing");
}

function makeApiError(err) {
  const { status, code, message } = getErrorDetails(err);
  const details = status ? `Gemini API returned HTTP ${status}` : "Gemini API request failed";
  const hint = isCredentialError(err)
    ? " Check that the GEMINI_API_KEY_* value is a valid Google AI Studio key, that it has not been revoked, and that GEMINI_ENDPOINT points to Google's Gemini API."
    : status === 404
      ? " Check the model ID and Gemini endpoint."
      : "";
  const safe = new Error(`${details}${code ? ` (${code})` : ""}: ${message || "No error message returned."}${hint}`);
  safe.status = status;
  safe.code = code;
  safe.cause = err;
  return safe;
}

function normalizePayload(payload) {
  const model = payload?.model || config.ai.geminiModel || config.ai.visionModel || "gemini-3.1-flash-lite";
  return { ...payload, model };
}

async function resolveImageUrls(payload) {
  if (!Array.isArray(payload?.messages)) return payload;
  const messages = [];
  for (const message of payload.messages) {
    if (!Array.isArray(message?.content)) {
      messages.push(message);
      continue;
    }
    const content = [];
    for (const item of message.content) {
      const url = item?.type === "image_url" ? item?.image_url?.url : null;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        content.push(item);
        continue;
      }
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 15000,
          maxContentLength: 20 * 1024 * 1024,
        });
        const mime = String(response.headers["content-type"] || "image/jpeg").split(";")[0];
        if (!mime.startsWith("image/")) {
          throw new Error("Remote attachment did not return an image content type.");
        }
        content.push({
          ...item,
          image_url: {
            ...item.image_url,
            url: `data:${mime};base64,${Buffer.from(response.data).toString("base64")}`,
          },
        });
      } catch (err) {
        // Keep provider errors and image-download failures separate; never log signed attachment URLs.
        console.warn("[GeminiClient] Could not inline remote image attachment:", err.message);
        content.push(item);
      }
    }
    messages.push({ ...message, content });
  }
  return { ...payload, messages };
}

async function requestWithKey(payload, apiKey) {
  return axios.post(GEMINI_ENDPOINT, payload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 30000,
  }).then((response) => response.data);
}

/**
 * Uses Google Gemini's OpenAI-compatible endpoint. Authentication failures stop immediately:
 * retrying the same bad credential against every configured key only adds noise and latency.
 */
export async function geminiChatCompletion(payload) {
  if (envKeys.length === 0) {
    throw new Error("Missing Gemini API key(s). Set GEMINI_API_KEY_ONE in the hosting environment.");
  }

  const processedPayload = await resolveImageUrls(normalizePayload(payload));
  let lastError;

  for (let index = 0; index < envKeys.length; index += 1) {
    try {
      console.info(`[GeminiClient] Sending request using configured key slot ${index + 1}.`);
      return await requestWithKey(processedPayload, envKeys[index]);
    } catch (err) {
      lastError = err;
      const { status, code, message } = getErrorDetails(err);
      console.error(`[GeminiClient] Request failed (key slot ${index + 1}, HTTP ${status || "network"}, code ${code || "unknown"}): ${message}`);

      if (isCredentialError(err)) {
        // A 401 is usually a wrong/revoked key or wrong endpoint, not quota. Stop
        // rotating so operators see the real configuration problem quickly.
        throw makeApiError(err);
      }

      if (isRetryableKeyError(err) && index < envKeys.length - 1) continue;

      // Model errors, malformed requests and network failures are not solved by changing keys.
      if (status && status !== 429 && status !== 402 && status < 500) throw makeApiError(err);
      if (index === envKeys.length - 1) throw makeApiError(err);
    }
  }

  throw makeApiError(lastError || new Error("No Gemini key available."));
}
