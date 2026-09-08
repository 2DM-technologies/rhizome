import { describe, expect, test } from "bun:test";
import type { SourceSkillManifest } from "@rhizome/store-contract";

import type {
  FileCaptureWorkerRequest,
  FileCaptureWorkerResponse,
} from "../../ingest/file-sources/preprocessing.ts";
import {
  FileCapturePreprocessorCatalog,
  prepareSourceCapture,
} from "../src/source-skills/fileCapturePreprocessors.ts";

const limits = {
  maxCandidates: 5,
  maxCaptureBytes: 8,
  maxElementBytes: 4,
  maxTotalElementBytes: 8,
} as const;

const manifest = {
  skill_id: "synthetic_archive",
  label: "Synthetic archive",
  description: "Synthetic worker preprocessing coverage.",
  source_kind: "file",
  connector_version: "origin-upload@test",
  parser: { name: "synthetic", version: "synthetic@0.0.0-test" },
  limits,
  file_capture: {
    kind: "file_capture_preprocessor@1",
    implementation: "synthetic_selection",
    version: "synthetic-selection@test",
  },
  input_fields: [
    {
      name: "file",
      label: "Archive",
      target: "source",
      control: "file",
      required: true,
      secret: false,
    },
  ],
  review_actions: ["review_import"],
} as const satisfies SourceSkillManifest;

describe("worker file capture preprocessors", () => {
  test("passes manifest limits to an allowlisted worker and returns its bounded capture", async () => {
    let worker: FakeCaptureWorker | undefined;
    const catalog = new FileCapturePreprocessorCatalog([
      {
        implementation: "synthetic_selection",
        version: "synthetic-selection@test",
        createWorker() {
          worker = new FakeCaptureWorker(() => ({
            kind: "prepared_file_capture",
            capture: {
              blob: new Blob(["derived"], { type: "application/x-synthetic" }),
              label: "selection.synthetic",
              mime: "application/x-synthetic",
            },
          }));
          return worker;
        },
      },
    ]);

    const original = new File([new Uint8Array(64)], "large.zip", { type: "application/zip" });
    const capture = await prepareSourceCapture(manifest, original, catalog);

    expect(worker?.request).toEqual({ kind: "prepare_file_capture", file: original, limits });
    expect(worker?.terminated).toBe(true);
    expect(capture).toMatchObject({
      label: "selection.synthetic",
      mime: "application/x-synthetic",
    });
    expect(capture.blob.size).toBe(7);
  });

  test("fails closed for missing workers and oversized derived captures", async () => {
    await expect(
      prepareSourceCapture(
        manifest,
        new File(["archive"], "archive.zip"),
        new FileCapturePreprocessorCatalog([]),
      ),
    ).rejects.toThrow("File capture preprocessor unavailable");

    const catalog = new FileCapturePreprocessorCatalog([
      {
        implementation: "synthetic_selection",
        version: "synthetic-selection@test",
        createWorker: () =>
          new FakeCaptureWorker(() => ({
            kind: "prepared_file_capture",
            capture: {
              blob: new Blob([new Uint8Array(9)]),
              label: "too-large.synthetic",
              mime: "application/x-synthetic",
            },
          })),
      },
    ]);
    await expect(
      prepareSourceCapture(manifest, new File(["archive"], "archive.zip"), catalog),
    ).rejects.toThrow("exceeds the 8 byte limit");
  });

  test("enforces the same capture limit when no preprocessing capability is declared", async () => {
    const directManifest = { ...manifest, file_capture: undefined };
    const direct = await prepareSourceCapture(
      directManifest,
      new File(["12345678"], "bounded.csv", { type: "text/csv" }),
    );
    expect(direct).toMatchObject({ label: "bounded.csv", mime: "text/csv" });
    await expect(
      prepareSourceCapture(directManifest, new File(["123456789"], "oversized.csv")),
    ).rejects.toThrow("exceeds the 8 byte limit");
  });
});

class FakeCaptureWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  request?: FileCaptureWorkerRequest;
  terminated = false;

  constructor(private readonly response: () => FileCaptureWorkerResponse) {}

  postMessage(message: FileCaptureWorkerRequest): void {
    this.request = message;
    queueMicrotask(() => this.onmessage?.({ data: this.response() } as MessageEvent<unknown>));
  }

  terminate(): void {
    this.terminated = true;
  }
}
