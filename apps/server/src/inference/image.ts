/** Inspect intrinsic image headers without decoding, resizing, or copying the payload. */
export function imageDimensions(
  mime: string,
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = (offset: number, signature: readonly number[]) =>
    signature.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, value: string) =>
    matches(
      offset,
      Array.from(value, (character) => character.charCodeAt(0)),
    );
  const dimensions = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : undefined;
  if (mime === "image/png") {
    if (
      bytes.length < 33 ||
      !matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) ||
      view.getUint32(8) !== 13 ||
      !ascii(12, "IHDR")
    )
      return;
    return dimensions(view.getUint32(16), view.getUint32(20));
  }
  if (mime === "image/gif") {
    if (bytes.length < 13 || !(ascii(0, "GIF87a") || ascii(0, "GIF89a"))) return;
    return dimensions(view.getUint16(6, true), view.getUint16(8, true));
  }
  if (mime === "image/jpeg") {
    if (!matches(0, [0xff, 0xd8])) return;
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return;
        return dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    return;
  }
  if (mime === "image/webp") {
    if (bytes.length < 20 || !ascii(0, "RIFF") || !ascii(8, "WEBP")) return;
    const size = view.getUint32(16, true);
    if (size > bytes.length - 20) return;
    if (ascii(12, "VP8X") && size >= 10) {
      const uint24 = (offset: number) =>
        bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16);
      return dimensions(uint24(24) + 1, uint24(27) + 1);
    }
    if (ascii(12, "VP8L") && size >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (ascii(12, "VP8 ") && size >= 10 && matches(23, [0x9d, 0x01, 0x2a]))
      return dimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
}
