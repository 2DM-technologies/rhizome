import { describe, expect, test } from "bun:test";
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";

import { openValidatedZip, readZipBytes, readZipText } from "./zip.ts";

const BACKSLASH = String.fromCharCode(92);
const NUL = String.fromCharCode(0);

/**
 * `openValidatedZip` is the replay boundary for the untrusted OAuth capture archive: the stored
 * OriginArtifact is re-read long after it was written, so every guard here runs against bytes the
 * server produced but no longer trusts. These cases were previously carried by the archive suite.
 */
describe("validated ZIP replay boundary", () => {
  test("shares an expanded-byte budget across independent and repeated reads", async () => {
    const opened = await openValidatedZip(
      await archive([
        ["a.bin", new Uint8Array(40)],
        ["b.bin", new Uint8Array(40)],
      ]),
      2,
      60,
    );
    try {
      await readZipBytes(opened.byPath.get("a.bin")!, 40);
      await expect(readZipBytes(opened.byPath.get("b.bin")!, 40)).rejects.toThrow(
        "total expanded-byte limit",
      );
      await expect(readZipBytes(opened.byPath.get("a.bin")!, 40)).rejects.toThrow(
        "total expanded-byte limit",
      );
    } finally {
      await opened.close();
    }
  });

  test("reads declared text and binary entries within their limits", async () => {
    const media = new Uint8Array([1, 2, 3, 4]);
    const opened = await openValidatedZip(
      await archive([
        ["manifest.json", '{"version":1}'],
        ["media/0.bin", media],
      ]),
    );
    try {
      expect(opened.entries).toHaveLength(2);
      expect(await readZipText(opened.byPath.get("manifest.json")!, 1_024)).toBe('{"version":1}');
      expect(await readZipBytes(opened.byPath.get("media/0.bin")!, 1_024)).toEqual(media);
    } finally {
      await opened.close();
    }
  });

  test("rejects traversal, absolute, and dot-segment entry names", async () => {
    // zip.js's own strict reader validation fires before `safePath` for these shapes, so the
    // boundary is belt-and-braces here and either rejection is correct.
    for (const path of ["../escape.txt", "data/../escape.txt", "/etc/passwd", "./relative.txt"]) {
      await expect(openValidatedZip(await archive([[path, "nope"]]))).rejects.toThrow(
        /[Uu]nsafe (?:filename|path)/,
      );
    }
  });

  test("rejects backslash, NUL-bearing, and over-long names that reach safePath", async () => {
    // zip.js only rejects a doubled leading backslash and a drive letter, so these shapes pass its
    // validation and prove `safePath` itself rather than the library underneath it.
    const unsafe = [
      `a${BACKSLASH}b.txt`,
      `media${BACKSLASH}0.bin`,
      `media${NUL}0.bin`,
      `${"a".repeat(1_025)}.json`,
    ];
    for (const path of unsafe) {
      await expect(openValidatedZip(await archive([[path, "nope"]]))).rejects.toThrow(
        "unsafe path",
      );
    }
  });

  test("accepts a dotted segment that does not escape", async () => {
    const opened = await openValidatedZip(await archive([["data/..hidden.json", "{}"]]));
    try {
      expect(opened.byPath.has("data/..hidden.json")).toBe(true);
    } finally {
      await opened.close();
    }
  });

  test("rejects duplicate and case-conflicting entry names", async () => {
    await expect(
      openValidatedZip(
        await archive([
          ["manifest.json", "{}"],
          ["MANIFEST.JSON", "{}"],
        ]),
      ),
    ).rejects.toThrow("duplicate or case-conflicting path");
  });

  test("rejects a ZIP-bomb entry from the central directory before reading its payload", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("manifest.json", new TextReader("{}"));
    await writer.add("bomb.txt", new TextReader("0".repeat(2 * 1_024 * 1_024)), { level: 9 });
    await expect(openValidatedZip(await writer.close())).rejects.toThrow(
      "unsafe compression ratio",
    );
  });

  test("enforces the entry ceiling and rejects an invalid ceiling", async () => {
    const zip = await archive([
      ["a.json", "{}"],
      ["b.json", "{}"],
    ]);
    await expect(openValidatedZip(zip, 1)).rejects.toThrow("too many entries");
    for (const invalid of [0, -1, 1.5, 100_001]) {
      await expect(openValidatedZip(zip, invalid)).rejects.toThrow("entry limit is invalid");
    }
    const opened = await openValidatedZip(zip, 2);
    await opened.close();
  });

  test("enforces per-entry byte limits at replay time", async () => {
    const opened = await openValidatedZip(await archive([["media/0.bin", new Uint8Array(64)]]));
    try {
      const entry = opened.byPath.get("media/0.bin")!;
      await expect(readZipBytes(entry, 32)).rejects.toThrow("exceeds its limit");
      expect(await readZipBytes(entry, 64)).toHaveLength(64);
    } finally {
      await opened.close();
    }
  });

  test("rejects a text entry that is not valid UTF-8", async () => {
    const opened = await openValidatedZip(
      await archive([["manifest.json", new Uint8Array([0xff, 0xfe, 0xfd])]]),
    );
    try {
      await expect(readZipText(opened.byPath.get("manifest.json")!, 1_024)).rejects.toThrow(
        "not valid UTF-8",
      );
    } finally {
      await opened.close();
    }
  });
});

async function archive(
  entries: ReadonlyArray<readonly [string, string | Uint8Array]>,
): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, body] of entries) {
    await writer.add(
      path,
      typeof body === "string" ? new TextReader(body) : new Uint8ArrayReader(body),
    );
  }
  return writer.close();
}
