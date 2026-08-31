import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const allowedRoot = resolve(import.meta.dir);
const providerPatterns = [
  /\bx_archive\b/,
  /\bx_oauth\b/,
  /api\.x\.com/,
  /https:\/\/(?:[A-Za-z0-9-]+\.)*x\.com(?:[/?#:]|$)/u,
  /https:\/\/t\.co(?:[/?#:]|$)/u,
  /help\.x\.com/,
  /twitter\.com/,
  /pbs\.twimg\.com/,
  /video\.twimg\.com/,
  /\btweet\.read\b/,
  /\busers\.read\b/,
  /\boffline\.access\b/,
  /\bRHIZOME_X_[A-Z0-9_]+\b/,
  /\b(?:referenced_tweets|edit_history_tweet_ids|possibly_sensitive|media_key)\b/,
  /\b(?:tweet\.fields|media\.fields|x-rate-limit-reset)\b/,
  /\/i\/oauth2\/authorize\b/,
  /\/oauth2\/(?:token|revoke)\b/,
  /\/users\/me\b/,
];

describe("X provider quarantine", () => {
  test("keeps source IDs, endpoints, scopes, and provider behavior inside the X package", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx,js,mjs,json,md}");
    for await (const path of glob.scan({ cwd: repoRoot, onlyFiles: true })) {
      const absolute = resolve(repoRoot, path);
      const fromAllowedRoot = relative(allowedRoot, absolute);
      if (
        fromAllowedRoot === "" ||
        (!fromAllowedRoot.startsWith("..") && !isAbsolute(fromAllowedRoot)) ||
        path.startsWith("impl/") ||
        path.startsWith("node_modules/") ||
        path.split("/").includes("dist") ||
        path.startsWith("coverage/") ||
        path.startsWith("dist-storybook/") ||
        path.startsWith("storybook-static/") ||
        path.startsWith(".rhizome/") ||
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
