// A complete one-pixel PNG, used by the blob-backed integration path and connector tests.
export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3cAAAAASUVORK5CYII=",
    "base64",
  ),
);
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = PNG.slice();
  const header = new DataView(bytes.buffer);
  header.setUint32(16, width);
  header.setUint32(20, height);
  return bytes;
}
