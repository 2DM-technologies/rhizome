import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4173;
const baseURL = `http://${host}:${port}`;
const hostDirectory = fileURLToPath(new URL("../", import.meta.url));
const serverTimeoutMs = 120_000;
const terminationSignals = ["SIGINT", "SIGTERM"];

let server;
let playwright;
let requestedSignal;
let resolveTermination;
const terminationRequested = new Promise((resolve) => {
  resolveTermination = resolve;
});
const signalHandlers = new Map(
  terminationSignals.map((signal) => [
    signal,
    () => {
      if (requestedSignal) return;
      requestedSignal = signal;
      resolveTermination(signal);
      if (processIsRunning(playwright)) playwright.kill(signal);
    },
  ]),
);
for (const [signal, handler] of signalHandlers) process.on(signal, handler);

let failure;

try {
  server = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", host, "--port", String(port), "--strictPort"],
    {
      cwd: hostDirectory,
      env: { ...process.env, VITE_RHIZOME_API_URL: baseURL },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  await waitForServer(server);
  throwIfTerminating();

  // Installed-skill suites exercise their workspace TypeScript directly, so keep Playwright on
  // Bun while this Node wrapper owns the cross-platform Vite process lifecycle.
  playwright = spawn(
    "bunx",
    [
      "--bun",
      "--no-install",
      "playwright",
      "test",
      "--config=playwright.config.ts",
      ...process.argv.slice(2),
    ],
    {
      cwd: hostDirectory,
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVER: "1" },
      stdio: "inherit",
    },
  );
  process.exitCode = await waitForPlaywright(playwright);
} catch (error) {
  failure = error;
} finally {
  await stopChild(server, "SIGTERM", 2_000);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
}

if (requestedSignal) process.exitCode = requestedSignal === "SIGINT" ? 130 : 143;
else if (failure) throw failure;

async function waitForServer(child) {
  const deadline = Date.now() + serverTimeoutMs;
  let startupError;
  child.once("error", (error) => {
    startupError = error;
  });

  while (Date.now() < deadline) {
    throwIfTerminating();
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Vite exited before becoming ready (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`,
      );
    }
    if (await serverIsReady()) return;
    await delay(100);
  }
  throw new Error(`Timed out after ${serverTimeoutMs}ms waiting for ${baseURL}`);
}

async function waitForPlaywright(child) {
  const exit = childExit(child);
  const outcome = await Promise.race([
    exit.then((result) => ({ kind: "exit", result })),
    terminationRequested.then((signal) => ({ kind: "termination", signal })),
  ]);

  if (outcome.kind === "termination") {
    if (processIsRunning(child)) child.kill(outcome.signal);
    const stopped = await Promise.race([exit.then(() => true), delay(5_000).then(() => false)]);
    if (!stopped && processIsRunning(child)) {
      child.kill("SIGKILL");
      await Promise.race([exit, delay(2_000)]);
    }
    return outcome.signal === "SIGINT" ? 130 : 143;
  }
  if (outcome.result.signal) {
    throw new Error(`Playwright exited from unexpected signal ${outcome.result.signal}`);
  }
  return outcome.result.code ?? 1;
}

async function serverIsReady() {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(1_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopChild(child, signal, graceMs) {
  if (!processIsRunning(child)) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await Promise.race([exited, delay(graceMs)]);
  if (processIsRunning(child)) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(2_000)]);
  }
}

function processIsRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function throwIfTerminating() {
  if (requestedSignal) throw new Error(`Received ${requestedSignal}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
