import { describe, expect, test } from "bun:test";

import { sourceConnectionReturnFailureMessage } from "../src/surfaces/sourceConnectionReturn.ts";

describe("source connection return failures", () => {
  test("maps callback, parameter, destination, and load failures to safe generic messages", () => {
    expect(
      sourceConnectionReturnFailureMessage({
        callbackFailed: true,
        invalidParameter: false,
        loadFailed: false,
      }),
    ).toBe("The source connection could not be completed. Start the connection again.");
    expect(
      sourceConnectionReturnFailureMessage({
        callbackFailed: false,
        invalidParameter: true,
        loadFailed: false,
      }),
    ).toBe("The source connection return was invalid. Start the connection again.");
    expect(
      sourceConnectionReturnFailureMessage({
        callbackFailed: false,
        invalidParameter: false,
        destinationError: "Destination mismatch",
        loadFailed: true,
      }),
    ).toBe("Destination mismatch");
    expect(
      sourceConnectionReturnFailureMessage({
        callbackFailed: false,
        invalidParameter: false,
        loadFailed: true,
      }),
    ).toBe("The source connection could not be loaded. Start the connection again.");
  });

  test("leaves successful and pending attempts for the consumer to handle and consume", () => {
    expect(
      sourceConnectionReturnFailureMessage({
        callbackFailed: false,
        invalidParameter: false,
        loadFailed: false,
      }),
    ).toBeUndefined();
  });
});
