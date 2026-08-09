// temp.js
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import readline from "node:readline";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY_ONE,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function main() {
  console.log("=== Gemini Discord CDN Test ===");
  console.log("Paste your prompt containing the Discord CDN URL.");
  console.log("Type 'exit' to quit.\n");

  while (true) {
    const prompt = await ask("Prompt: ");

    if (prompt.trim().toLowerCase() === "exit") {
      break;
    }

    if (!prompt.trim()) continue;

    try {
      console.log("\nSending to Gemini...\n");

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
      });

      console.log("=== Gemini Response ===");
      console.log(response.text);
      console.log("=======================\n");
    } catch (error) {
      console.error("\nGemini Error:");
      console.error(error);
      console.log();
    }
  }

  rl.close();
}

main();