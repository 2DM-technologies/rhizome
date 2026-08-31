import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const allowedRoot = resolve(import.meta.dir);
const providerPatterns = [
  /\bx_archive\b/,
  /\bx_oauth\b/,
  /api\.x\.com/,
  /help\.x\.com/,
  /twitter\.com/,
  /\btweet\.read\b/,
  /\busers\.read\b/,
  /\boffline\.access\b/,
];

describe("X provider quarantine", () => {
  test("keeps source IDs, endpoints, scopes, and provider behavior inside the X package", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx,js,mjs,json,md}");
    for await (const path of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      const absolute = resolve(repoRoot, path);
      if (
        absolute.startsWith(allowedRoot) ||
        path.startsWith("impl/") ||
        path.startsWith("node_modules/") ||
        path.startsWith(".git/") ||
        path === "bun.lock"
      ) {
        continue;
      }
      const contents = await readFile(absolute, "utf8");
      if (providerPatterns.some((pattern) => pattern.test(contents))) {
        violations.push(relative(repoRoot, absolute));
      }
    }
    expect(violations).toEqual([]);
  });
});
