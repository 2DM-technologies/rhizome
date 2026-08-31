import type {
  FileCaptureWorkerRequest,
  FileCaptureWorkerResponse,
} from "../../../file-sources/preprocessing.ts";

import { prepareXArchiveCapture } from "./browser-capture.ts";

self.onmessage = async (event: MessageEvent<FileCaptureWorkerRequest>) => {
  let response: FileCaptureWorkerResponse;
  try {
    if (event.data.kind !== "prepare_file_capture") throw new Error("Unsupported worker request");
    response = {
      kind: "prepared_file_capture",
      capture: await prepareXArchiveCapture(event.data.file, event.data.limits),
    };
  } catch (error) {
    response = {
      kind: "file_capture_error",
      message: error instanceof Error ? error.message : "X archive preprocessing failed",
    };
  }
  self.postMessage(response);
};
