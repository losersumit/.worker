import test from "node:test";
import assert from "node:assert/strict";
import { analyzePrompt } from "./promptAnalyzer.js";

test("text that mentions an attachment placeholder remains text-only", () => {
  const result = analyzePrompt({
    messages: [{ role: "user", content: "BonD : attachment1 — what is in this picture?" }],
  });
  assert.equal(result.modality, "text");
  assert.equal(result.hasImages, false);
  assert.equal(result.imageCount, 0);
});

test("an actual image_url part selects image modality", () => {
  const result = analyzePrompt({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What is in this image?" },
        { type: "image_url", image_url: { url: "https://cdn.example.test/truck.png" } },
      ],
    }],
  });
  assert.equal(result.modality, "image");
  assert.equal(result.hasImages, true);
  assert.equal(result.imageCount, 1);
});

test("explicit image attachments are normalized into a real image part", () => {
  const result = analyzePrompt({
    messages: [{ role: "user", content: "Describe this attachment." }],
    attachments: [{ url: "https://cdn.example.test/convoy.webp?token=abc", name: "convoy.webp" }],
  });
  assert.equal(result.modality, "image");
  assert.equal(result.imageCount, 1);
  assert.equal(result.payload.messages[0].content[1].type, "image_url");
});

test("duplicate image URLs count only once", () => {
  const result = analyzePrompt({
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://cdn.example.test/convoy.png" } },
        { type: "image_url", image_url: { url: "https://cdn.example.test/convoy.png" } },
      ],
    }],
  });
  assert.equal(result.hasImages, true);
  assert.equal(result.imageCount, 1);
});

test("router-only metadata is not forwarded to the provider", () => {
  const result = analyzePrompt({
    sourceFeature: "unit test",
    modality: "image",
    messages: [{ role: "user", content: "plain text" }],
  });
  assert.equal("sourceFeature" in result.payload, false);
  assert.equal("modality" in result.payload, false);
});
