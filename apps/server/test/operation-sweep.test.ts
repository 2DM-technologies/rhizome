import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("the standalone boot sweep is invoked only from index.ts", async () => {
  const root = resolve(import.meta.dir, "../src");
  const callers: string[] = [];
  for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: root })) {
    if (path === "services/operation-sweep.ts") continue;
    if (/\bsweepInterruptedOperations\s*\(/.test(await Bun.file(resolve(root, path)).text()))
      callers.push(path);
  }
  expect(callers).toEqual(["index.ts"]);
  const entry = await Bun.file(resolve(root, "index.ts")).text();
  expect(entry.indexOf("await sweepInterruptedOperations(db)")).toBeGreaterThan(
    entry.indexOf("const { db } = createDatabase"),
  );
  expect(entry.indexOf("await sweepInterruptedOperations(db)")).toBeLessThan(
    entry.indexOf("export default"),
  );
});
