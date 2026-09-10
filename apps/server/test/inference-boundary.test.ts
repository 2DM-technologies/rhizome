import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "../../..");
const inference = resolve(root, "apps/server/src/inference");

function imports(code: string): string[] {
  const source = ts.createSourceFile("boundary.ts", code, ts.ScriptTarget.Latest, true);
  const modules: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      modules.push(node.argument.literal.text);
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      modules.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) modules.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return modules;
}
function violates(file: string, code: string): boolean {
  if (file.startsWith(`${inference}/`) || /\.(test|e2e)\.[cm]?[jt]sx?$/.test(file)) return false;
  return imports(code).some((name) => {
    const target = name.startsWith(".") ? resolve(dirname(file), name) : name;
    return /(?:^|\/)inference\/openai(?:\/|$)/.test(target);
  });
}
describe("inference provider quarantine", () => {
  test("only inference wiring and tests import the OpenAI implementation", async () => {
    const bad: string[] = [];
    for await (const relative of new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}").scan({
      cwd: root,
    })) {
      if (relative.split("/").some((part) => part === "node_modules" || part === "dist")) continue;
      const file = resolve(root, relative);
      if (violates(file, await Bun.file(file).text())) bad.push(relative);
    }
    expect(bad).toEqual([]);
    const providerImports = imports(
      await Bun.file(resolve(root, "apps/server/src/config.ts")).text(),
    ).filter((name) => name.includes("inference"));
    expect(providerImports).toEqual(["./inference/config.ts"]);
  });
  test("detects imports, reexports and dynamic imports across the boundary", () => {
    const outsider = resolve(root, "apps/server/src/push/example.ts");
    for (const code of [
      'import { x } from "../inference/openai/connector.ts"',
      'export * from "../inference/openai/connector.ts"',
      'import("../inference/openai/connector.ts")',
      'require("../inference/openai/connector.ts")',
      'type Provider = import("../inference/openai/connector.ts").OpenAIConnector',
      'import "../inference/openai"',
    ])
      expect(violates(outsider, code)).toBe(true);
    expect(
      violates(resolve(inference, "connector-registry.ts"), 'import "./openai/connector.ts"'),
    ).toBe(false);
    expect(
      violates(
        resolve(root, "apps/server/test/openai.test.ts"),
        'import "../src/inference/openai/connector.ts"',
      ),
    ).toBe(false);
  });
  test("no workspace installs the OpenAI SDK", async () => {
    for await (const relative of new Bun.Glob(
      "{package.json,apps/*/package.json,packages/*/package.json,dmachines/*/package.json}",
    ).scan({ cwd: root })) {
      const manifest = await Bun.file(resolve(root, relative)).json();
      expect(manifest.dependencies?.openai).toBeUndefined();
      expect(manifest.devDependencies?.openai).toBeUndefined();
    }
  });
});
