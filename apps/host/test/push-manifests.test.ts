import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUSH_TASK_LEVELS } from "@rhizome/store-contract";

import { installedPushTasks } from "../../server/src/push/installed-tasks.ts";
import { PUSH_TASKS } from "../src/api/generated/push-tasks.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("generated push task manifests", () => {
  test("PUSH_TASKS is exactly the discovery manifests keyed by level and name", () => {
    const manifests = installedPushTasks.manifests();
    expect(
      Object.fromEntries(
        PUSH_TASK_LEVELS.map((level) => [
          level,
          Object.fromEntries(
            manifests.filter((task) => task.level === level).map((task) => [task.name, task]),
          ),
        ]),
      ),
    ).toEqual(PUSH_TASKS);
  });

  test("openapi:check rejects a stale push task file even when openapi.ts is current", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "rhizome-push-manifests-"));
    try {
      await mkdir(join(scratch, "scripts"), { recursive: true });
      await mkdir(join(scratch, "apps/host/src/api/generated"), { recursive: true });
      // Execute the real generator with isolated outputs and read-only links to its inputs.
      for (const path of ["node_modules", "packages", "apps/server", "apps/ingest"])
        await symlink(join(root, path), join(scratch, path), "dir");
      for (const path of [
        ".prettierrc.json",
        "scripts/generate-host-openapi.ts",
        "apps/host/src/api/generated/openapi.ts",
        "apps/host/src/api/generated/push-tasks.ts",
      ])
        await copyFile(join(root, path), join(scratch, path));

      const check = async () => {
        const process = Bun.spawn(
          [Bun.which("bun")!, "scripts/generate-host-openapi.ts", "--check"],
          {
            cwd: scratch,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [status, output, error] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
        ]);
        return { status, output: output + error };
      };
      const current = await check();
      expect(current).toEqual({ status: 0, output: "" });
      const taskFile = join(scratch, "apps/host/src/api/generated/push-tasks.ts");
      await Bun.write(taskFile, `${await Bun.file(taskFile).text()}\n// stale\n`);
      const stale = await check();
      expect(stale.status).not.toBe(0);
      expect(stale.output).toContain("Generated host files are stale:");
      expect(stale.output).toContain(taskFile);
      expect(stale.output).not.toContain(join(scratch, "apps/host/src/api/generated/openapi.ts"));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
