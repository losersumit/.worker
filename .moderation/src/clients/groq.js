import "../utils/loadEnv.js";
import axios from "axios";

const keys = [
  process.env.GROQ_API_KEY_ONE,
  process.env.GROQ_API_KEY_TWO || process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_THREE,
  process.env.GROQ_API_KEY_FOUR,
  process.env.GROQ_API_KEY_FIVE,
  process.env.GROQ_API_KEY_SIX,
  process.env.GROQ_API_KEY_SEVEN,
  process.env.GROQ_API_KEY_EIGHT,
].filter((key) => typeof key === "string" && key.trim());

const GROQ_ENDPOINT = process.env.GROQ_ENDPOINT || "https://api.groq.com/openai/v1/chat/completions";

function errorDetails(err) {
  const error = err?.response?.data?.error;
  return {
    status: err?.response?.status,
    code: String(error?.code || error?.type || ""),
    message: String(error?.message || err?.message || ""),
  };
}

function isAuthOrLimitError(err) {
  const { status, code, message } = errorDetails(err);
  return status === 401 || status === 403 || status === 402 || status === 429 ||
    /quota|rate.?limit|billing|resource_exhausted|insufficient_quota/i.test(`${code} ${message}`);
}

function formatError(err) {
  const { status, code, message } = errorDetails(err);
  const safe = new Error(`Groq API ${status ? `HTTP ${status}` : "request failed"}${code ? ` (${code})` : ""}: ${message}`);
  safe.status = status;
  safe.code = code;
  safe.cause = err;
  return safe;
}

/** Sends only Groq model IDs to Groq; Gemini IDs must use geminiChatCompletion. */
export async function groqChatCompletion(payload) {
  if (keys.length === 0) {
    throw new Error("Missing Groq API key(s). Set GROQ_API_KEY_ONE or GROQ_API_KEY in the hosting environment.");
  }
  if (!payload?.model || /^google\/|^gemini-/i.test(payload.model)) {
    throw new Error(`Invalid Groq model "${payload?.model || "(missing)"}". Configure a model ID supported by Groq; Gemini models must be called with geminiChatCompletion().`);
  }

  let lastError;
  for (let index = 0; index < keys.length; index += 1) {
    try {
      console.info(`[GroqClient] Request using configured key slot ${index + 1}, model ${payload.model}.`);
      const response = await axios.post(GROQ_ENDPOINT, payload, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${keys[index]}` },
        timeout: 30000,
      });
      return response.data;
    } catch (err) {
      lastError = err;
      const { status, code, message } = errorDetails(err);
      console.error(`[GroqClient] Request failed (key slot ${index + 1}, HTTP ${status || "network"}, code ${code || "unknown"}): ${message}`);

      // Invalid model/request cannot be repaired by trying other API keys.
      if (status === 400 || status === 404) throw formatError(err);
      if (!isAuthOrLimitError(err) || index === keys.length - 1) throw formatError(err);
    }
  }
  throw formatError(lastError || new Error("No Groq key available."));
}
