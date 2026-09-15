import { expect, test, type Page } from "@playwright/test";

import { ORB_PRESETS } from "../src/orb/recipe.ts";
import { installMockStore } from "./support/mockStore.ts";

async function probeGraphics(page: Page) {
  await page.addInitScript(() => {
    const probe = { programs: 0, draws: 0, bufferResizes: 0 };
    Object.defineProperty(window, "__orbPerformance", { value: probe });
    const prototype = WebGL2RenderingContext.prototype;
    const createProgram = prototype.createProgram;
    const drawArrays = prototype.drawArrays;
    prototype.createProgram = function () {
      probe.programs += 1;
      return createProgram.call(this);
    };
    prototype.drawArrays = function (...args) {
      probe.draws += 1;
      return drawArrays.apply(this, args);
    };
    for (const dimension of ["width", "height"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dimension)!;
      Object.defineProperty(HTMLCanvasElement.prototype, dimension, {
        ...descriptor,
        set(value) {
          probe.bufferResizes += 1;
          descriptor.set!.call(this, value);
        },
      });
    }
  });
}

async function graphics(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __orbPerformance: { programs: number; draws: number; bufferResizes: number };
        }
      ).__orbPerformance,
  );
}

test("passing over cards skips live renderers, and repeated hover reuses the canvas and program", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const base = store.vibes[0]!;
  base.inferred = {
    "rhizome:vibe-orb": { model: "test", properties: { ...ORB_PRESETS.bloom } },
  };
  store.vibes.push({
    ...structuredClone(base),
    uri: "rnet://vibe/0198f2a1-a09b-76aa-95d8-fc5b55b41fd3",
    title: "Other card",
  });
  await probeGraphics(page);
  await page.goto("/");
  const cards = page.locator("[data-desktop-vibe-card]");
  await expect(cards.locator('[data-vibe-orb-renderer="raster"] img')).toHaveCount(2);
  const baseline = await graphics(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  for (const card of await cards.all()) {
    await card.dispatchEvent("pointerover", { pointerType: "mouse" });
    await page.clock.runFor(50);
    await card.dispatchEvent("pointerout", { pointerType: "mouse" });
  }
  await page.clock.runFor(150);
  await expect(cards.locator("canvas")).toHaveCount(0);
  expect((await graphics(page)).programs).toBe(baseline.programs);

  await cards.first().dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(150);
  await expect(cards.first().locator("canvas")).toHaveCount(1);
  await page.clock.runFor(50);
  await expect(cards.first().locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(1);
  const canvas = await cards.first().locator("canvas").elementHandle();
  const afterHover = await graphics(page);
  expect(afterHover.programs - baseline.programs).toBe(1);
  await cards.first().dispatchEvent("pointerout", { pointerType: "mouse" });
  await expect(cards.locator("canvas")).toHaveCount(0);
  expect(await canvas!.evaluate((element) => element.isConnected)).toBe(false);
  const idle = await graphics(page);
  await page.clock.runFor(500);
  expect(await graphics(page)).toEqual(idle);

  await cards.last().dispatchEvent("pointerover", { pointerType: "mouse" });
  await page.clock.runFor(150);
  await expect(cards.last().locator("canvas")).toHaveCount(1);
  await page.clock.runFor(50);
  await expect(cards.last().locator('[data-vibe-orb-renderer="webgl"]')).toHaveCount(1);
  expect(
    await canvas!.evaluate(
      (element) => element === document.querySelector("[data-desktop-vibe-card] canvas"),
    ),
  ).toBe(true);
  expect((await graphics(page)).programs).toBe(afterHover.programs);
  expect((await graphics(page)).bufferResizes).toBe(afterHover.bufferResizes);
  await cards.last().dispatchEvent("pointerout", { pointerType: "mouse" });
  await expect(cards.locator("canvas")).toHaveCount(0);
  await page.clock.runFor(30_100);
  expect(
    await canvas!.evaluate((element) =>
      (element as HTMLCanvasElement).getContext("webgl2")!.isContextLost(),
    ),
  ).toBe(true);
  await canvas!.dispose();
});

test("icon draws are capped on fast displays, event bursts coalesce, and settled recipes stop allocating", async ({
  page,
}) => {
  await installMockStore(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const rendererPath = "/src/orb/renderer.ts";
    const recipePath = "/src/orb/recipe.ts";
    const { OrbRenderer } = await import(rendererPath);
    const { ORB_PRESETS } = await import(recipePath);
    const nativeRaf = window.requestAnimationFrame;
    const nativeCancel = window.cancelAnimationFrame;
    const nativeNow = performance.now;
    const NativeArray = Float32Array;
    const nativeDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio")!;
    let now = performance.now();
    let nextFrame = 0;
    let allocations = 0;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    performance.now = () => now;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 3 });
    window.Float32Array = new Proxy(NativeArray, {
      construct(target, args) {
        allocations += 1;
        return Reflect.construct(target, args);
      },
    });
    function frame(milliseconds: number) {
      now += milliseconds;
      const pending = [...frames];
      for (const [id, callback] of pending) {
        if (frames.delete(id)) callback(now);
      }
    }
    const rates = [];
    try {
      for (const hz of [120, 144, 240]) {
        const renderer = OrbRenderer.forIcon(ORB_PRESETS.bloom);
        const canvas: HTMLCanvasElement = renderer.canvas;
        canvas.style.cssText = "width:44px;height:44px";
        document.body.append(canvas);
        renderer.resize();
        const gl = canvas.getContext("webgl2")!;
        const drawArrays = gl.drawArrays;
        const uniform3fv = gl.uniform3fv;
        let draws = 0;
        let uploads = 0;
        const times: number[] = [];
        // u_time is the only changing float while the orb has no pointer interaction.
        const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
        const timeLocation = gl.getUniformLocation(program, "u_time")!;
        gl.drawArrays = function (...args) {
          draws += 1;
          times.push(gl.getUniform(program, timeLocation) as number);
          drawArrays.apply(this, args);
        };
        gl.uniform3fv = function (...args) {
          uploads += 1;
          uniform3fv.apply(this, args);
        };
        try {
          frame(1000 / hz);
          const firstTime = times.at(-1)!;
          const firstDraws = draws;
          const firstUploads = uploads;
          const firstAllocations = allocations;
          for (let i = 0; i < hz; i++) frame(1000 / hz);
          rates.push({
            hz,
            draws: draws - firstDraws,
            elapsed: times.at(-1)! - firstTime,
            buffer: [canvas.width, canvas.height],
            uploads: uploads - firstUploads,
            allocations: allocations - firstAllocations,
          });

          renderer.setRecipe(ORB_PRESETS.ember, 100);
          for (let i = 0; i < hz; i++) frame(1000 / hz);
          if (uploads <= firstUploads + 1) throw new Error("Recipe transition did not draw");
          const settledUploads = uploads;
          const settledAllocations = allocations;
          const settledDraws = draws;
          for (let i = 0; i < hz; i++) frame(1000 / hz);
          if (uploads !== settledUploads || allocations !== settledAllocations) {
            throw new Error("Settled recipe still uploads or allocates arrays");
          }
          if (draws - settledDraws < 28) throw new Error("Settled motion stopped");
          renderer.setRecipe(structuredClone(ORB_PRESETS.ember));
          for (let i = 0; i < hz / 2; i++) frame(1000 / hz);
          if (uploads !== settledUploads || allocations !== settledAllocations) {
            throw new Error("An equivalent recipe restarted its transition");
          }

          renderer.setMotion("still");
          frame(40);
          const beforeBurst = draws;
          for (let i = 0; i < 50; i++) {
            renderer.resize();
            renderer.setInteraction(true);
            canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: i, clientY: i }));
          }
          if (draws !== beforeBurst || frames.size !== 1) {
            throw new Error("Events drew synchronously or queued duplicate frames");
          }
          frame(40);
          if (draws !== beforeBurst + 1 || Number(frames.size) !== 0) {
            throw new Error("A still event burst did not settle after one draw");
          }
          renderer.setMotion("continuous");
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          document.dispatchEvent(new Event("visibilitychange"));
          const beforeHidden = draws;
          frame(100);
          renderer.resize();
          frame(100);
          if (draws !== beforeHidden || Number(frames.size) !== 0) {
            throw new Error("Hidden document kept drawing");
          }
          Reflect.deleteProperty(document, "hidden");
          document.dispatchEvent(new Event("visibilitychange"));
          frame(40);
          if (draws !== beforeHidden + 1) throw new Error("Visible document failed to resume");
          renderer.setReducedMotion(true);
          frame(40);
          const frozenDraws = draws;
          frame(100);
          if (draws !== frozenDraws || times.at(-1) !== 0) {
            throw new Error("Reduced motion kept animating");
          }
        } finally {
          gl.drawArrays = drawArrays;
          gl.uniform3fv = uniform3fv;
          renderer.destroy({ recycle: true });
          canvas.remove();
        }
        if (Number(frames.size) !== 0) throw new Error("Recycled renderer left an animation frame");
      }
      return rates;
    } finally {
      Reflect.deleteProperty(document, "hidden");
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCancel;
      performance.now = nativeNow;
      window.Float32Array = NativeArray;
      Object.defineProperty(window, "devicePixelRatio", nativeDpr);
      window.dispatchEvent(new Event("pagehide"));
    }
  });
  for (const rate of result) {
    expect(rate.draws, `${rate.hz} Hz`).toBeGreaterThanOrEqual(28);
    expect(rate.draws, `${rate.hz} Hz`).toBeLessThanOrEqual(30);
    expect(rate.elapsed).toBeGreaterThan(0.96);
    expect(rate.elapsed).toBeLessThanOrEqual(1.01);
    expect(rate.buffer).toEqual([66, 66]);
    expect(rate.uploads).toBe(0);
    expect(rate.allocations).toBe(0);
  }
});

test("live icons pause offscreen, recover from context loss, and never reuse a lost idle context", async ({
  page,
}) => {
  await installMockStore(page);
  await probeGraphics(page);
  await page.goto("/");
  const orb = await page.evaluateHandle(async () => {
    const rendererPath = "/src/orb/renderer.ts";
    const recipePath = "/src/orb/recipe.ts";
    const { OrbRenderer } = await import(rendererPath);
    const { ORB_PRESETS } = await import(recipePath);
    const availability: boolean[] = [];
    const renderer = OrbRenderer.forIcon(ORB_PRESETS.bloom, {
      onContextAvailabilityChange: (ready: boolean) => availability.push(ready),
    });
    renderer.canvas.style.cssText = "position:fixed;top:0;left:0;width:40px;height:40px";
    document.body.append(renderer.canvas);
    renderer.resize();
    return { renderer, availability, OrbRenderer, recipe: ORB_PRESETS.ember };
  });
  await expect.poll(() => orb.evaluate(({ availability }) => availability)).toEqual([true]);
  await orb.evaluate(({ renderer }) => {
    renderer.canvas.style.left = "-1000px";
  });
  await expect
    .poll(() => orb.evaluate(({ renderer }) => renderer.canvas.dataset.vibeOrbAnimating))
    .toBe("false");
  const offscreen = await graphics(page);
  await page.waitForTimeout(180);
  expect(await graphics(page)).toEqual(offscreen);
  await orb.evaluate(({ renderer }) => {
    renderer.canvas.style.left = "0";
  });
  await expect.poll(async () => (await graphics(page)).draws).toBeGreaterThan(offscreen.draws);

  const extension = await orb.evaluateHandle(({ renderer }) =>
    renderer.canvas.getContext("webgl2").getExtension("WEBGL_lose_context"),
  );
  await extension.evaluate((extension) => extension.loseContext());
  await expect.poll(() => orb.evaluate(({ availability }) => availability)).toEqual([true, false]);
  const lost = await graphics(page);
  await page.waitForTimeout(180);
  expect(await graphics(page)).toEqual(lost);
  await extension.evaluate((extension) => extension.restoreContext());
  await expect
    .poll(() => orb.evaluate(({ availability }) => availability))
    .toEqual([true, false, true]);
  expect((await graphics(page)).programs).toBe(lost.programs + 1);
  await orb.evaluate(({ renderer }) => {
    renderer.destroy({ recycle: true });
    renderer.canvas.remove();
  });
  const idle = await graphics(page);
  await page.waitForTimeout(180);
  expect(await graphics(page)).toEqual(idle);
  // There is no live renderer listening to an idle canvas; the next acquisition must reject it.
  await orb.evaluate(({ renderer }) =>
    renderer.canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext(),
  );
  await expect
    .poll(() =>
      orb.evaluate(({ renderer }) => renderer.canvas.getContext("webgl2").isContextLost()),
    )
    .toBe(true);
  const replaced = await orb.evaluate(({ renderer, OrbRenderer, recipe }) => {
    const next = OrbRenderer.forIcon(recipe);
    const changed = renderer.canvas !== next.canvas;
    next.destroy();
    return changed;
  });
  expect(replaced).toBe(true);
  expect((await graphics(page)).programs).toBe(idle.programs + 1);
  await extension.dispose();
  await orb.dispose();
});

test("the idle pool retains at most two programs and releases them on pagehide", async ({
  page,
}) => {
  await installMockStore(page);
  await probeGraphics(page);
  await page.goto("/");
  const pool = await page.evaluateHandle(async () => {
    const rendererPath = "/src/orb/renderer.ts";
    const recipePath = "/src/orb/recipe.ts";
    const { OrbRenderer } = await import(rendererPath);
    const { ORB_PRESETS } = await import(recipePath);
    const renderers = Array.from({ length: 3 }, () => OrbRenderer.forIcon(ORB_PRESETS.bloom));
    for (const renderer of renderers) renderer.destroy({ recycle: true });
    return { renderers, OrbRenderer, recipe: ORB_PRESETS.ember };
  });
  await expect
    .poll(() =>
      pool.evaluate(({ renderers }) =>
        renderers.map((renderer) => renderer.canvas.getContext("webgl2").isContextLost()),
      ),
    )
    .toEqual([true, false, false]);
  const idle = await graphics(page);
  const reuse = await pool.evaluate(({ renderers, OrbRenderer, recipe }) => {
    const next = OrbRenderer.forIcon(recipe);
    const same = next.canvas === renderers[2].canvas;
    next.destroy({ recycle: true });
    // Cleanup is idempotent, so a repeated destroy cannot enqueue duplicate painters.
    next.destroy({ recycle: true });
    return same;
  });
  expect(reuse).toBe(true);
  expect(await graphics(page)).toEqual(idle);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect
    .poll(() =>
      pool.evaluate(({ renderers }) =>
        renderers.every((renderer) => renderer.canvas.getContext("webgl2").isContextLost()),
      ),
    )
    .toBe(true);
  await pool.dispose();
});
