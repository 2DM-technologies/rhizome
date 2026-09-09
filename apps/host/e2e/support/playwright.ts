/**
 * Colocated source-skill suites live outside the Host workspace package, so their Playwright
 * runtime is deliberately re-exported from the package that owns the browser-test dependency.
 */
export { expect, test } from "@playwright/test";
export type { Page } from "@playwright/test";
