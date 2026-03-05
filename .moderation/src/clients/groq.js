import '../utils/loadEnv.js';
import axios from 'axios';
import config from '../config.js'; // Updated import path

// Five-key failover for Groq's OpenAI-compatible API.
export const api_key_one = process.env.GROQ_API_KEY_ONE || '';
export const api_key_two = process.env.GROQ_API_KEY_TWO || process.env.GROQ_API_KEY || '';
export const api_key_three = process.env.GROQ_API_KEY_THREE || '';
export const api_key_four = process.env.GROQ_API_KEY_FOUR || '';
export const api_key_five = process.env.GROQ_API_KEY_FIVE || '';
export const api_key_six = process.env.GROQ_API_KEY_SIX || '';

const GROQ_ENDPOINT =
    process.env.GROQ_ENDPOINT || 'https://api.groq.com/openai/v1/chat/completions';

const keys = [api_key_one, api_key_two, api_key_three, api_key_four, api_key_five, api_key_six].filter(k => k);
let activeKeyIndex = 0;

function normalizeErrorMessage(err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = data?.error?.code || data?.error?.type || '';
    const message = data?.error?.message || err?.message || '';
    return { status, code: String(code), message: String(message) };
}

function isQuotaOrTokenExhaustion(err) {
    const { status, code, message } = normalizeErrorMessage(err);
    const haystack = `${code} ${message}`.toLowerCase();

    // Groq/OpenAI-compatible APIs typically use 429 for quota/rate limiting.
    // We only fail over when it's likely "out of tokens/quota", not generic transient errors.
    const looksLikeQuota =
        haystack.includes('insufficient_quota') ||
        haystack.includes('quota') ||
        haystack.includes('exceeded') ||
        haystack.includes('token') ||
        haystack.includes('billing') ||
        haystack.includes('credits') ||
        haystack.includes('rate limit') ||
        status === 401 ||                 // Invalid key
        status === 403;                   // Forbidden (sometimes used for invalid keys)

    return (status === 429 || status === 402 || status === 401 || status === 403) && looksLikeQuota;
}

async function postWithKey(payload, apiKey) {
    const res = await axios.post(GROQ_ENDPOINT, payload, {
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        timeout: 30000
    });
    return res.data;
}

/**
 * Call Groq Chat Completions with automatic simple failover across available keys.
 * If the active key hits quota/token exhaustion, it rotates to the next available key and retries.
 * Handles 404 Model Not Found by switching to fallback model if available.
 */
export async function groqChatCompletion(payload) {
    console.log(`[GroqClient] Starting request with model: ${payload.model}`);

    if (keys.length === 0) {
        console.error('[GroqClient] No API keys found!');
        throw new Error(
            'Missing Groq API key(s). Set GROQ_API_KEY_ONE (and optionally others).'
        );
    }

    // Try active key first
    try {
        console.log(`[GroqClient] Attempting request with key index ${activeKeyIndex}...`);
        const result = await postWithKey(payload, keys[activeKeyIndex]);
        console.log(`[GroqClient] Request successful with key index ${activeKeyIndex}.`);
        return result;
    } catch (err) {
        console.error(`[GroqClient] Request failed with key index ${activeKeyIndex}.`);
        const status = err?.response?.status;
        const errorData = err?.response?.data?.error;
        console.error(`[GroqClient] Error details: Status=${status}, Code=${errorData?.code}, Message=${errorData?.message}`);

        // Check for Model Not Found (404)
        if (status === 404 && (errorData?.code === 'model_not_found' || errorData?.message?.includes('does not exist') || errorData?.message?.includes('not exist'))) {
            console.warn('[GroqClient] Model not found. Checking for fallback...');

            // Check if we are using the primary vision model and have a fallback
            if (payload.model === config.ai.visionModel && config.ai.fallbackVisionModel) {
                console.warn(`[GroqClient] Switching to fallback vision model: ${config.ai.fallbackVisionModel}`);
                payload.model = config.ai.fallbackVisionModel;

                // Retry immediately with the same key but different model
                try {
                    console.log(`[GroqClient] Retrying with fallback model and key index ${activeKeyIndex}...`);
                    const result = await postWithKey(payload, keys[activeKeyIndex]);
                    console.log(`[GroqClient] Retry successful with fallback model.`);
                    return result;
                } catch (fallbackErr) {
                    console.error('[GroqClient] Fallback model request also failed.');
                    // Update error reference to continue with normal failover if needed
                    err = fallbackErr;
                }
            } else {
                console.warn('[GroqClient] No fallback model configured or already using fallback.');
            }
        }

        if (!isQuotaOrTokenExhaustion(err)) {
            console.error('[GroqClient] Error is NOT quota/token related (and not 401/403). Re-throwing.');
            throw err;
        }

        if (keys.length === 1) {
            console.error('[GroqClient] Only 1 key available, cannot failover.');
            throw err;
        }

        // Fail over to next key
        // Try each other key exactly once to find one that works
        const startIndex = activeKeyIndex;
        let nextIndex = (activeKeyIndex + 1) % keys.length;

        console.warn(`[GroqClient] Limit/Auth issue on key ${activeKeyIndex}. Starting failover sequence...`);

        while (nextIndex !== startIndex) {
            console.warn(`[GroqClient] Switching to key index ${nextIndex}.`);
            activeKeyIndex = nextIndex;

            try {
                console.log(`[GroqClient] Retrying with key index ${activeKeyIndex}...`);
                const result = await postWithKey(payload, keys[activeKeyIndex]);
                console.log(`[GroqClient] Retry successful with key index ${activeKeyIndex}.`);
                return result;
            } catch (err2) {
                console.error(`[GroqClient] Retry failed with key index ${activeKeyIndex}.`);
                const status2 = err2?.response?.status;
                const errorData2 = err2?.response?.data?.error;
                console.error(`[GroqClient] Error details: Status=${status2}, Code=${errorData2?.code}, Message=${errorData2?.message}`);

                // If this new key ALSO fails with quota/auth, continue loop.
                // If it fails with something else, throw.
                if (!isQuotaOrTokenExhaustion(err2)) {
                    console.error('[GroqClient] Failover error is NOT quota/token related. Re-throwing.');
                    throw err2;
                }
                nextIndex = (activeKeyIndex + 1) % keys.length;
            }
        }

        // If we looped all the way back, we're out of luck.
        console.error('[GroqClient] All keys exhausted.');
        throw err;
    }
}
