/**
 * Analyze the structured request payload to decide whether it includes images.
 * Text mentioning "image" or "attachment1" alone does not count as an image.
 */
const IMAGE_EXTENSIONS = /\.(apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;

function isImageAttachment(item) {
  if (!item || typeof item !== "object") return false;
  const mime = String(item.contentType || item.content_type || item.mimeType || item.mime_type || "").toLowerCase();
  const name = String(item.name || item.filename || item.fileName || "");
  return mime.startsWith("image/") || IMAGE_EXTENSIONS.test(name);
}

function imageUrlFromPart(part) {
  if (!part || typeof part !== "object") return null;
  if (part.type === "image_url") {
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }
  if (part.type === "input_image") {
    const url = part.image_url || part.url;
    return typeof url === "string" && url.trim() ? url.trim() : null;
  }
  return null;
}

function addExplicitAttachments(request, messages) {
  const attachments = [
    ...(Array.isArray(request.attachments) ? request.attachments : []),
    ...(Array.isArray(request.images) ? request.images : []),
  ].filter(isImageAttachment);

  if (!attachments.length) return messages;

  let targetIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex < 0) {
    messages.push({ role: "user", content: "Inspect the attached image(s)." });
    targetIndex = messages.length - 1;
  }

  const target = { ...messages[targetIndex] };
  const parts = Array.isArray(target.content)
    ? [...target.content]
    : [{ type: "text", text: String(target.content ?? "") }];
  const seen = new Set(parts.map(imageUrlFromPart).filter(Boolean));

  for (const attachment of attachments) {
    const url = attachment.url || attachment.proxyURL || attachment.proxy_url;
    if (typeof url !== "string" || !url.trim() || seen.has(url)) continue;
    parts.push({ type: "image_url", image_url: { url: url.trim() } });
    seen.add(url);
  }

  target.content = parts;
  messages[targetIndex] = target;
  return messages;
}

/**
 * @returns {{ modality: "text"|"image", hasImages: boolean, imageCount: number, payload: object }}
 */
export function analyzePrompt(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("AI prompt must be an object containing a messages array.");
  }

  const messages = Array.isArray(request.messages)
    ? request.messages.map(message => ({ ...message }))
    : [];
  addExplicitAttachments(request, messages);

  const imageUrls = new Set();
  for (const message of messages) {
    const parts = Array.isArray(message?.content) ? message.content : [];
    for (const part of parts) {
      const url = imageUrlFromPart(part);
      if (url) imageUrls.add(url);
    }
  }

  const {
    attachments: _attachments,
    images: _images,
    modality: _modality,
    sourceFeature: _sourceFeature,
    ...providerPayload
  } = request;
  providerPayload.messages = messages;

  return {
    modality: imageUrls.size ? "image" : "text",
    hasImages: imageUrls.size > 0,
    imageCount: imageUrls.size,
    payload: providerPayload,
  };
}
