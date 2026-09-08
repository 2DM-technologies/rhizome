import type { SourceExecutionLimits, SourceSkillManifest } from "@rhizome/store-contract";

import type {
  FileCapturePreprocessor,
  FileCaptureWorkerRequest,
  FileCaptureWorkerResponse,
  PreparedSourceCapture,
} from "../../../ingest/file-sources/preprocessing.ts";
import { installedFileCapturePreprocessorRegistrations } from "../../../ingest/src/file-capture-preprocessor-catalog.ts";

interface CaptureWorker {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: FileCaptureWorkerRequest): void;
  terminate(): void;
}

export interface FileCapturePreprocessorRegistration {
  readonly implementation: string;
  readonly version: string;
  createWorker(): CaptureWorker;
}

/** Executable preprocessors are an explicit client allowlist, independent of source-skill ids. */
export class FileCapturePreprocessorCatalog {
  readonly #registrations: ReadonlyMap<string, FileCapturePreprocessorRegistration>;

  constructor(registrations: readonly FileCapturePreprocessorRegistration[]) {
    const byPin = new Map<string, FileCapturePreprocessorRegistration>();
    for (const registration of registrations) {
      if (
        !/^[a-z][a-z0-9_-]{0,63}$/.test(registration.implementation) ||
        !registration.version ||
        typeof registration.createWorker !== "function"
      ) {
        throw new Error("Invalid file capture preprocessor registration");
      }
      const key = preprocessorKey(registration.implementation, registration.version);
      if (byPin.has(key)) throw new Error(`Duplicate file capture preprocessor: ${key}`);
      byPin.set(key, Object.freeze(registration));
    }
    this.#registrations = byPin;
  }

  forManifest(manifest: SourceSkillManifest): FileCapturePreprocessor | undefined {
    if (!manifest.file_capture) return undefined;
    const registration = this.#registrations.get(
      preprocessorKey(manifest.file_capture.implementation, manifest.file_capture.version),
    );
    if (!registration) {
      throw new Error(
        `File capture preprocessor unavailable: ${manifest.file_capture.implementation}@${manifest.file_capture.version}`,
      );
    }
    return workerPreprocessor(registration.createWorker);
  }
}

/** Generated source-package registration will populate this bootstrap seam. */
export const installedFileCapturePreprocessors = new FileCapturePreprocessorCatalog(
  installedFileCapturePreprocessorRegistrations,
);

export async function prepareSourceCapture(
  manifest: SourceSkillManifest,
  file: File,
  catalog: FileCapturePreprocessorCatalog = installedFileCapturePreprocessors,
): Promise<PreparedSourceCapture> {
  const preprocessor = catalog.forManifest(manifest);
  const capture = preprocessor
    ? await preprocessor.prepare(file, manifest.limits)
    : { blob: file, label: file.name, mime: file.type || "application/octet-stream" };
  assertPreparedCapture(capture, manifest.limits);
  return {
    ...capture,
    blob:
      capture.blob.type === capture.mime
        ? capture.blob
        : new Blob([capture.blob], { type: capture.mime }),
  };
}

function workerPreprocessor(createWorker: () => CaptureWorker): FileCapturePreprocessor {
  return {
    prepare(file, limits) {
      const worker = createWorker();
      return new Promise<PreparedSourceCapture>((resolve, reject) => {
        const finish = (result: () => void) => {
          worker.terminate();
          result();
        };
        worker.onerror = (event) =>
          finish(() => reject(new Error(event.message || "File capture worker failed")));
        worker.onmessage = (event) => {
          let response: FileCaptureWorkerResponse;
          try {
            response = parseWorkerResponse(event.data);
          } catch (error) {
            finish(() => reject(error));
            return;
          }
          if (response.kind === "file_capture_error") {
            finish(() => reject(new Error(response.message)));
            return;
          }
          finish(() => resolve(response.capture));
        };
        worker.postMessage({ kind: "prepare_file_capture", file, limits });
      });
    },
  };
}

function parseWorkerResponse(value: unknown): FileCaptureWorkerResponse {
  if (!value || typeof value !== "object")
    throw new Error("File capture worker returned no result");
  const response = value as Partial<FileCaptureWorkerResponse>;
  if (response.kind === "file_capture_error" && typeof response.message === "string") {
    return { kind: response.kind, message: response.message };
  }
  if (response.kind === "prepared_file_capture" && response.capture) {
    return { kind: response.kind, capture: response.capture };
  }
  throw new Error("File capture worker returned an invalid result");
}

function assertPreparedCapture(
  capture: PreparedSourceCapture,
  limits: SourceExecutionLimits,
): void {
  if (
    !(capture.blob instanceof Blob) ||
    capture.blob.size <= 0 ||
    capture.blob.size > limits.maxCaptureBytes ||
    typeof capture.label !== "string" ||
    !capture.label.trim() ||
    typeof capture.mime !== "string" ||
    !capture.mime.trim()
  ) {
    throw new Error(
      capture.blob instanceof Blob && capture.blob.size > limits.maxCaptureBytes
        ? `Prepared capture exceeds the ${limits.maxCaptureBytes} byte limit`
        : "File capture preprocessor returned an invalid capture",
    );
  }
}

function preprocessorKey(implementation: string, version: string): string {
  return `${implementation}\u0000${version}`;
}
