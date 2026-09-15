import { expect, test } from "@playwright/test";
import { installMockStore } from "./support/mockStore.ts";

test("interaction-only orbs settle in elapsed time even at five rendered frames per second", async ({
  page,
}) => {
  await installMockStore(page);
  await page.goto("/");
  const observations = await page.evaluate(async () => {
    const rendererModule = "/src/orb/renderer.ts";
    const recipeModule = "/src/orb/recipe.ts";
    const { OrbRenderer } = (await import(
      rendererModule
    )) as typeof import("../src/orb/renderer.ts");
    const { ORB_PRESETS } = (await import(recipeModule)) as typeof import("../src/orb/recipe.ts");
    const nativeRaf = window.requestAnimationFrame;
    const nativeCancel = window.cancelAnimationFrame;
    const nativeNow = performance.now;
    let now = performance.now();
    let next = 0;
    const frames = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      frames.set(++next, callback);
      return next;
    };
    window.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
    performance.now = () => now;
    const rows = [];
    try {
      for (const frameMs of [1000 / 60, 1000 / 30, 100, 200]) {
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:20px;height:20px;position:fixed;left:0;top:0";
        document.body.append(canvas);
        const renderer = new OrbRenderer(canvas, ORB_PRESETS.bloom, {
          motion: "interaction",
          maxFps: 30,
        });
        try {
          const step = () => {
            now += frameMs;
            for (const [id, callback] of [...frames]) if (frames.delete(id)) callback(now);
          };
          renderer.setInteraction(true);
          step();
          renderer.setInteraction(false);
          const start = now;
          while (canvas.dataset.vibeOrbAnimating !== "false" && now - start < 3000) step();
          rows.push({ frameMs, elapsed: now - start, animating: canvas.dataset.vibeOrbAnimating });
        } finally {
          renderer.destroy();
          canvas.remove();
        }
      }
    } finally {
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCancel;
      performance.now = nativeNow;
    }
    return rows;
  });
  for (const row of observations) {
    expect(row.animating, JSON.stringify(row)).toBe("false");
    expect(row.elapsed).toBeLessThan(2100);
  }
});
