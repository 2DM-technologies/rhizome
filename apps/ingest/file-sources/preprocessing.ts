import type { SourceExecutionLimits } from "../../../packages/store-contract/src/source-skills.ts";

export interface PreparedSourceCapture {
  readonly blob: Blob;
  readonly label: string;
  readonly mime: string;
}

/** Browser-side privacy boundary for deriving a bounded capture before upload. */
export interface FileCapturePreprocessor {
  prepare(file: File, limits: SourceExecutionLimits): Promise<PreparedSourceCapture>;
}

export interface FileCaptureWorkerRequest {
  readonly kind: "prepare_file_capture";
  readonly file: File;
  readonly limits: SourceExecutionLimits;
}

export type FileCaptureWorkerResponse =
  | {
      readonly kind: "prepared_file_capture";
      readonly capture: PreparedSourceCapture;
    }
  | {
      readonly kind: "file_capture_error";
      readonly message: string;
    };
