import { describe, expect, test } from "bun:test";
import type { SourceSkillManifest } from "@rhizome/store-contract";

import { prepareSourceCapture } from "../src/source-skills/fileCapture.ts";

const manifest = {
  skill_id: "synthetic_file",
  label: "Synthetic file source",
  description: "Synthetic file capture coverage.",
  source_kind: "file",
  connector_version: "origin-upload@test",
  parser: { name: "synthetic", version: "synthetic@0.0.0-test" },
  limits: {
    maxCandidates: 5,
    maxCaptureBytes: 8,
    maxElementBytes: 4,
    maxTotalElementBytes: 8,
  },
  input_fields: [
    {
      name: "file",
      label: "Export",
      target: "source",
      control: "file",
      required: true,
      secret: false,
    },
  ],
  review_actions: ["review_import"],
  import_push_pipeline: [],
} as const satisfies SourceSkillManifest;

describe("file capture", () => {
  test("uploads the selected file as-is and enforces the manifest capture limit", async () => {
    const capture = await prepareSourceCapture(
      manifest,
      new File(["12345678"], "bounded.qfx", { type: "application/x-ofx" }),
    );
    expect(capture).toMatchObject({ label: "bounded.qfx", mime: "application/x-ofx" });
    expect(capture.blob.size).toBe(8);

    await expect(
      prepareSourceCapture(manifest, new File(["123456789"], "oversized.qfx")),
    ).rejects.toThrow("exceeds the 8 byte limit");
  });

  test("labels a typeless file with a generic binary MIME", async () => {
    const capture = await prepareSourceCapture(manifest, new File(["abc"], "untyped"));
    expect(capture).toMatchObject({ label: "untyped", mime: "application/octet-stream" });
    expect(capture.blob.type).toBe("application/octet-stream");
  });
});
