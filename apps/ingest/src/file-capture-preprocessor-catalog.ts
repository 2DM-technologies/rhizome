import { xArchivePreprocessorRegistration } from "../skills/x/archive/browser-capture.ts";

/**
 * Installed browser preprocessor registrations. This is the generated/package-catalog seam: the
 * host consumes only these generic implementation/version registrations and never imports a
 * provider package directly.
 */
export const installedFileCapturePreprocessorRegistrations = Object.freeze([
  xArchivePreprocessorRegistration,
]);
