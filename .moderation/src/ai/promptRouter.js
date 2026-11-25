import "../utils/loadEnv.js";
import { analyzePrompt } from "./promptAnalyzer.js";
import { geminiChatCompletion } from "../clients/gemini.js";
import { groqChatCompletion } from "../clients/groq.js";

/**
 * Every feature sends its completed request through this function. The
 * analyzer examines the structured payload, then this router selects provider
 * and model. Prompt text that merely mentions an attachment is not an image.
 */
export async function routeAiPrompt(request, options = {}) {
  const analysis = analyzePrompt(request);
  const model = analysis.hasImages
    ? "gemini-3.1-flash-lite"
    : "openai/gpt-oss-120b";

  const payload = { ...analysis.payload, model };
  const source = String(options.sourceFeature || request?.sourceFeature || "unspecified-feature");

  console.info(
    `[AI Router] feature=${source} modality=${analysis.modality} images=${analysis.imageCount} provider=${analysis.hasImages ? "Gemini" : "Groq"} model=${model}`
  );

  if (analysis.hasImages) return geminiChatCompletion(payload);
  return groqChatCompletion(payload);
}
