import { imageDimensions } from "../image.ts";
import type { CompletionRequest } from "../model-connector.ts";

// Luna high detail: 2048px maximum dimension, 2500 32px patches, 1.2 tokens/patch.
// https://developers.openai.com/api/docs/guides/images-vision#patch-based-image-tokenization
export function lunaImageTokens(width: number, height: number): number {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error("Invalid image dimensions");
  const fit = Math.min(1, 2048 / width, 2048 / height);
  width = Math.max(1, Math.floor(width * fit));
  height = Math.max(1, Math.floor(height * fit));
  if (Math.ceil(width / 32) * Math.ceil(height / 32) > 2500) {
    const shrink = Math.sqrt((32 * 32 * 2500) / (width * height));
    const adjusted =
      shrink *
      Math.min(
        Math.floor((width * shrink) / 32) / ((width * shrink) / 32),
        Math.floor((height * shrink) / 32) / ((height * shrink) / 32),
      );
    width = Math.floor(width * adjusted);
    height = Math.floor(height * adjusted);
  }
  return Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.2);
}

/** Packing estimate only; billing always comes from response usage. */
export function countLunaInputTokens(
  input: Pick<CompletionRequest, "instructions" | "input" | "attachments">,
): number {
  const markers = (input.attachments ?? []).map(({ ref }) => ref).join("");
  let tokens = Math.ceil(
    new TextEncoder().encode(input.instructions + input.input + markers).byteLength / 4,
  );
  for (const attachment of input.attachments ?? []) {
    const size = imageDimensions(attachment.mime, attachment.bytes);
    if (!size) throw new Error("Unsupported image attachment");
    tokens += lunaImageTokens(size.width, size.height);
  }
  return tokens;
}
