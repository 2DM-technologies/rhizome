import { expect, test, type Page } from "@playwright/test";
import type { Vibe } from "@rnet/types";

import {
  ELEMENT_ID,
  ELEMENT_URI,
  installMockStore,
  NEW_VIBE_ID,
  OBJECT_ID,
  OBJECT_URI,
  PAYLOAD_TEXT,
  VIBE_ID,
  type MockStore,
} from "./support/mockStore.ts";

let mockStore: MockStore;

test.beforeEach(async ({ page }) => {
  mockStore = await installMockStore(page);
});

async function sampleLauncherXWhileClicking(page: Page, accessibleName: string): Promise<number[]> {
  return page.evaluate(async (name) => {
    const launcher = document.querySelector<HTMLElement>("[data-launcher-slot]");
    const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getClientRects().length > 0 && button.getAttribute("aria-label") === name,
    );
    if (!launcher || !trigger) throw new Error(`Could not sample dock motion for ${name}`);

    const sampledLauncher = launcher;
    const samples = [sampledLauncher.getBoundingClientRect().x];
    trigger.click();
    const stopAt = performance.now() + 180;
    await new Promise<void>((resolve) => {
      function sample() {
        samples.push(sampledLauncher.getBoundingClientRect().x);
        if (performance.now() < stopAt) requestAnimationFrame(sample);
        else resolve();
      }
      requestAnimationFrame(sample);
    });
    return samples;
  }, accessibleName);
}

function expectMonotonicMotion(samples: number[], direction: "increasing" | "decreasing") {
  expect(samples.length).toBeGreaterThan(2);
  const tolerance = 0.75;
  const start = samples[0] as number;
  const end = samples.at(-1) as number;
  const lowerBound = Math.min(start, end) - tolerance;
  const upperBound = Math.max(start, end) + tolerance;

  expect(Math.abs(end - start)).toBeGreaterThan(1);
  for (const sample of samples) {
    expect(sample).toBeGreaterThanOrEqual(lowerBound);
    expect(sample).toBeLessThanOrEqual(upperBound);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] as number;
    const current = samples[index] as number;
    if (direction === "increasing") expect(current).toBeGreaterThanOrEqual(previous - tolerance);
    else expect(current).toBeLessThanOrEqual(previous + tolerance);
  }
}

interface DockOpenAnimationRecord {
  finished: boolean;
  keyframes: Array<{
    clipPath: number | string | null;
    offset: number | string | null;
    opacity: number | string | null;
    transform: number | string | null;
  }>;
  origin: {
    height: number;
    left: number;
    top: number;
    width: number;
  } | null;
  source: string | null;
  surfaceId: string | null;
  target: "content" | "surface";
  targetRect: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
  timing: {
    delay: number | string | null;
    duration: number | string | null;
    easing: string | null;
    fill: string | null;
  };
}

async function installDockOpenAnimationProbe(page: Page) {
  await page.addInitScript(() => {
    const nativeAnimate = Element.prototype.animate;
    const records: DockOpenAnimationRecord[] = [];

    function serialize(value: unknown): number | string | null {
      if (typeof value === "number" || typeof value === "string") return value;
      return value == null ? null : String(value);
    }

    Element.prototype.animate = function (keyframes, options) {
      const element = this as HTMLElement;
      const surface = element.matches("[data-surface-opening]")
        ? element
        : element.closest<HTMLElement>("[data-surface-opening]");
      const target = element === surface ? "surface" : "content";
      const rect = element.getBoundingClientRect();
      const animation = nativeAnimate.call(this, keyframes, options);
      if (!surface || (target === "content" && !element.matches("[data-surface-window]"))) {
        return animation;
      }

      const serializedKeyframes = Array.isArray(keyframes)
        ? keyframes.map((keyframe) => {
            const frame = keyframe as unknown as Record<string, unknown>;
            return {
              clipPath: serialize(frame.clipPath),
              offset: serialize(frame.offset),
              opacity: serialize(frame.opacity),
              transform: serialize(frame.transform),
            };
          })
        : [];
      const firstTransform = serializedKeyframes[0]?.transform;
      let origin: DockOpenAnimationRecord["origin"] = null;
      if (target === "surface" && typeof firstTransform === "string") {
        const matrix = new DOMMatrixReadOnly(firstTransform);
        origin = {
          height: rect.height * Math.abs(matrix.d),
          left: rect.left + matrix.m41,
          top: rect.top + matrix.m42,
          width: rect.width * Math.abs(matrix.a),
        };
      }
      const timing = typeof options === "number" ? { duration: options } : options;
      const record: DockOpenAnimationRecord = {
        finished: false,
        keyframes: serializedKeyframes,
        origin,
        source: surface.dataset.surfaceOpeningSource ?? null,
        surfaceId: surface.dataset.surfaceId ?? null,
        target,
        targetRect: {
          height: rect.height,
          left: rect.left,
          top: rect.top,
          width: rect.width,
        },
        timing: {
          delay: serialize(timing?.delay),
          duration: serialize(timing?.duration),
          easing: typeof timing?.easing === "string" ? timing.easing : null,
          fill: typeof timing?.fill === "string" ? timing.fill : null,
        },
      };
      records.push(record);
      void animation.finished.then(
        () => {
          record.finished = true;
        },
        () => {
          record.finished = true;
        },
      );
      return animation;
    };

    Object.defineProperty(window, "__rhizomeDockOpenAnimations", { value: records });
  });
}

function readDockOpenAnimationProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __rhizomeDockOpenAnimations: DockOpenAnimationRecord[];
        }
      ).__rhizomeDockOpenAnimations,
  );
}

function expectOriginToMatch(
  actual: DockOpenAnimationRecord["origin"],
  expected: { height: number; width: number; x: number; y: number },
) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual?.left ?? 0) - expected.x)).toBeLessThan(0.75);
  expect(Math.abs((actual?.top ?? 0) - expected.y)).toBeLessThan(0.75);
  expect(Math.abs((actual?.width ?? 0) - expected.width)).toBeLessThan(0.75);
  expect(Math.abs((actual?.height ?? 0) - expected.height)).toBeLessThan(0.75);
}

test("an object deep link resolves through the real shell and Store client", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);

  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(page.getByLabel("User properties, as JSON")).toHaveValue(
    JSON.stringify({ reviewed: false }, null, 2),
  );
  await expect(page.getByRole("button", { name: "Maximize window" })).toBeVisible();

  const favicon = page.locator('link[rel~="icon"]');
  await expect(favicon).toHaveAttribute("type", "image/png");
  await expect(favicon).toHaveAttribute("sizes", "96x96");
  await expect(favicon).toHaveAttribute("href", /orb-home-48\.png$/);
});

test("the window back button only traverses prior in-app navigation", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);

  const back = page.getByRole("button", { name: "Back" });
  await expect(back).toBeVisible();
  await expect(back).toBeDisabled();
  const backBox = await back.boundingBox();
  const maximizeBox = await page.getByRole("button", { name: "Maximize window" }).boundingBox();
  expect(backBox).toMatchObject({ width: 32, height: 32 });
  expect(maximizeBox).not.toBeNull();
  expect(backBox!.x).toBeLessThan(maximizeBox!.x);
  expect(backBox!.y).toBe(maximizeBox!.y);

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(back).toBeEnabled();

  const paintedSurfaceIds = await page.evaluate(async (objectId) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.getAttribute("aria-label") === "Back",
    );
    if (!button) throw new Error("Missing window Back button");

    const expectedPath = `/objects/${objectId}`;
    const expectedSurfaceId = `object:${objectId}`;
    const frames: Array<string | null> = [];
    button.click();

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("Back navigation did not restore the object window")),
        2_000,
      );
      function sample() {
        const active = document.querySelector<HTMLElement>("[data-view-mode]:not([hidden])");
        const activeId = active?.dataset.surfaceId ?? null;
        frames.push(activeId);
        if (location.pathname === expectedPath && activeId === expectedSurfaceId) {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });

    return frames;
  }, OBJECT_ID);

  // A history POP names its destination before the window store catches up. Every paint must
  // still contain a focused window; otherwise Back visibly flashes the bare desktop.
  expect(paintedSurfaceIds).not.toContain(null);
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(back).toBeDisabled();
});

test("legacy saved sessions discard accumulated windows during hydration", async ({ page }) => {
  await page.addInitScript((objectId) => {
    sessionStorage.setItem(
      "rhizome.shell",
      JSON.stringify({
        state: {
          open: [{ kind: "object", uuid: objectId }, { kind: "vibes" }],
          defaultViewMode: "standard",
        },
        version: 0,
      }),
    );
  }, OBJECT_ID);

  await page.goto(`/objects/${OBJECT_ID}`);

  const windows = page.locator("[data-surface-window]");
  await expect(windows).toHaveCount(1);
  await expect(windows).toHaveAttribute("data-surface-id", `object:${OBJECT_ID}`);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const persisted = sessionStorage.getItem("rhizome.shell");
        if (!persisted) return null;
        const parsed = JSON.parse(persisted) as {
          state?: { open?: unknown[]; recentVibeSurfaces?: unknown[] };
          version?: number;
        };
        return {
          open: parsed.state?.open,
          recentVibeSurfaces: parsed.state?.recentVibeSurfaces,
          version: parsed.version,
        };
      }),
    )
    .toEqual({
      open: [{ kind: "object", uuid: OBJECT_ID }],
      recentVibeSurfaces: [{ kind: "vibes" }],
      version: 3,
    });
});

test("persisted Vibe recents keep dock geometry stable while their titles hydrate", async ({
  page,
}) => {
  const baseVibe = mockStore.vibes[0];
  if (!baseVibe) throw new Error("Missing seeded Vibe");
  const libraryUuid = "0198f2a1-a09b-76aa-95d8-fc5b55b41fd3";
  mockStore.vibes.push({
    ...structuredClone(baseVibe),
    uri: `rnet://vibe/${libraryUuid}`,
    title: "Library",
  });

  await page.addInitScript(
    ({ recentVibeUuids }) => {
      sessionStorage.setItem(
        "rhizome.shell",
        JSON.stringify({
          state: {
            open: [],
            recentVibeUuids,
            defaultViewMode: "standard",
          },
          version: 2,
        }),
      );
    },
    { recentVibeUuids: [VIBE_ID, libraryUuid] },
  );

  let releaseCatalog!: () => void;
  let markCatalogPending!: () => void;
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const catalogPending = new Promise<void>((resolve) => {
    markCatalogPending = resolve;
  });
  await page.route("**/rnet/v0/vibes", async (route) => {
    if (route.request().method() === "GET") {
      markCatalogPending();
      await catalogGate;
    }
    await route.fallback();
  });

  await page.goto("/");
  await catalogPending;

  const rail = page.locator("[data-dock-recent-vibes]");
  const items = rail.getByRole("button");
  const launcher = page.locator("[data-launcher-slot]");
  await expect(rail).toHaveAttribute("data-count", "2");
  await expect(items).toHaveCount(2);
  expect(await rail.evaluate((element) => element.clientWidth)).toBe(108);
  expect(await items.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    `Vibe …${VIBE_ID.slice(-6)}`,
    `Vibe …${libraryUuid.slice(-6)}`,
  ]);
  const launcherBeforeCatalog = await launcher.boundingBox();
  expect(launcherBeforeCatalog).not.toBeNull();

  releaseCatalog();
  await expect(items.nth(0)).toHaveAccessibleName("Spending");
  await expect(items.nth(1)).toHaveAccessibleName("Library");
  await expect(rail).toHaveCSS("width", "108px");
  await expect.poll(() => launcher.boundingBox()).toEqual(launcherBeforeCatalog);
});

test("the dock stays dark while its search field stays light", async ({ page }) => {
  await page.goto("/");

  expect(
    await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [
          step,
          root.getPropertyValue(`--rz-gray-${step}`).trim(),
        ]),
      );
    }),
  ).toEqual({
    50: "#fafafa",
    100: "#f5f5f5",
    200: "#e5e5e5",
    300: "#d4d4d4",
    400: "#a3a3a3",
    500: "#737373",
    600: "#525252",
    700: "#3f3f3f",
    800: "#252525",
    900: "#111111",
  });

  const tray = page.locator("[data-dock-tray-backdrop]");
  const searchBlur = page.locator("[data-launcher-blur]");
  const searchSurface = page.locator("[data-launcher-surface]");
  const searchIcon = page.locator("[data-launcher-input-row] svg");
  const search = page.getByRole("searchbox", { name: "Search everything" });
  await expect(tray).toHaveCSS(
    "background-color",
    "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  await expect(searchSurface).toHaveCSS("background-color", "rgba(255, 255, 250, 0.9)");
  await expect(searchSurface).toHaveCSS("opacity", "1");
  await expect(searchBlur).toHaveCSS("backdrop-filter", "blur(20px)");
  await expect(search).toHaveCSS("color", "rgb(20, 21, 26)");
  await expect(search).toHaveCSS("font-size", "14px");
  await expect(searchIcon).toHaveCSS("width", "16px");
  await expect(searchIcon).toHaveCSS("height", "16px");

  await search.click();
  await expect(page.getByRole("dialog", { name: "Start something new" })).toBeVisible();
  await expect(searchSurface).toHaveCSS("background-color", "rgba(255, 255, 250, 0.9)");
  await expect(searchSurface).toHaveCSS("opacity", "1");
  await expect(searchBlur).toHaveCSS("backdrop-filter", "blur(24px)");
  await expect(searchBlur).toHaveCSS("opacity", "1");
});

test("the collapsed and expanded search surfaces follow --rz-dock-search", async ({ page }) => {
  await page.goto("/");

  const search = page.getByRole("searchbox", { name: "Search everything" });
  const searchSurface = page.locator("[data-launcher-surface]");
  await expect(searchSurface).toHaveCSS("background-color", "rgba(255, 255, 250, 0.9)");

  await page.evaluate(() => document.documentElement.style.setProperty("--rz-dock-search", "red"));
  await expect(searchSurface).toHaveCSS("background-color", "rgb(255, 0, 0)");

  await search.click();
  await expect(page.getByRole("dialog", { name: "Start something new" })).toBeVisible();
  await expect(searchSurface).toHaveCSS("background-color", "rgb(255, 0, 0)");
});

test("standard and maximized windows preserve breathing room above the dock", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.goto("/m/Geometry");

  const surface = page.locator("[data-view-mode]");
  const window = page.locator("[data-surface-window]");
  const dock = page.locator("[data-shell-dock]");
  const dockTray = page.locator("[data-dock-tray]");
  const dockTrayBackdrop = page.locator("[data-dock-tray-backdrop]");
  const contentTitle = window.getByText("Geometry", { exact: true });
  await expect(contentTitle).toBeVisible();
  await expect(page.locator("[data-dock-app-label]")).toHaveText("Geometry");
  const contentBox = await contentTitle.boundingBox();

  await expect(surface).toHaveAttribute("data-view-mode", "standard");
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 48,
      y: 24,
      width: 1632,
      height: 864,
    });
  const standardWindowBox = await window.boundingBox();
  const standardDockBox = await dockTray.boundingBox();
  expect(standardWindowBox).not.toBeNull();
  expect(standardDockBox).not.toBeNull();
  expect(standardWindowBox!.y).toBe(
    standardDockBox!.y - (standardWindowBox!.y + standardWindowBox!.height),
  );

  const maximize = page.getByRole("button", { name: "Maximize window" });
  const close = page.getByRole("button", { name: "Close surface" });
  const maximizeBox = await maximize.boundingBox();
  const closeBox = await close.boundingBox();
  expect(maximizeBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(maximizeBox).toMatchObject({ y: closeBox!.y, width: 32, height: 32 });
  expect(maximizeBox!.x + maximizeBox!.width).toBeLessThan(closeBox!.x);

  await maximize.click();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await expect(surface).toHaveAttribute("data-view-mode", "maximized");
  await expect(page.getByRole("button", { name: "Restore window" })).toBeVisible();
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 0,
      y: 0,
      width: 1728,
      height: 1000,
    });

  await expect(dock).toBeVisible();
  await expect(dock).toBeInViewport();
  await expect(surface).toHaveCSS("background-color", "rgb(255, 255, 250)");
  const windowBox = await window.boundingBox();
  const dockBox = await dockTray.boundingBox();
  expect(windowBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(dockBox).toMatchObject({ x: 206, width: 1474, height: 64 });
  expect(dockBox!.y + dockBox!.height).toBe(976);
  expect(dockBox!.y).toBeLessThan(windowBox!.y + windowBox!.height);
  await expect(dockTray).toHaveCSS("border-radius", "12px");
  await expect(dockTrayBackdrop).toHaveCSS(
    "background-color",
    "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  await expect(dockTrayBackdrop).toHaveCSS("backdrop-filter", "blur(10px)");
  expect(await contentTitle.boundingBox()).toEqual(contentBox);

  await page.getByRole("button", { name: "Restore window" }).click();
  await expect(page).toHaveURL(/\/m\/Geometry$/);
  await expect
    .poll(() => window.boundingBox())
    .toEqual({
      x: 48,
      y: 24,
      width: 1632,
      height: 864,
    });
});

test("window mode is inherited until a window is restored", async ({ page }) => {
  await page.goto("/m/Geometry");
  const activeSurface = page.locator("[data-view-mode]:not([hidden])");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await page.getByRole("button", { name: "Maximize window" }).click();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-view-mode", "maximized");
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  // The previous window was closed, but returning to its history entry reopens it in the
  // inherited mode without retaining the Vibes tree in the background.
  await page.goBack();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-surface-id", "m:Geometry");
  await expect(activeSurface).toHaveAttribute("data-view-mode", "maximized");
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  await page.goForward();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-surface-id", "vibes");
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  // Closing and reloading the bare desktop do not implicitly reset the persisted mode.
  await activeSurface.getByRole("button", { name: "Close surface" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-view-mode", "maximized");

  await activeSurface.getByRole("button", { name: "Restore window" }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(activeSurface).toHaveAttribute("data-view-mode", "standard");
});

test("a maximized host surface scrolls at the browser edge behind the dock", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(`/objects/${OBJECT_ID}`);

  const heading = page.getByRole("heading", { name: "note" });
  const surface = page.locator("[data-view-mode]");
  const window = page.locator("[data-surface-window]");
  const scrollport = page.locator("[data-surface-scrollport]");
  const controls = page.locator("[data-window-controls]");
  await expect(heading).toBeVisible();
  await expect(scrollport).toHaveCSS("padding-top", "52px");
  const contentBox = await heading.boundingBox();
  await page.getByRole("button", { name: "Maximize window" }).click();
  await expect.poll(() => window.boundingBox()).toEqual({ x: 0, y: 0, width: 1200, height: 600 });
  await expect(window).toHaveCSS("border-radius", "0px");
  await expect(window).toHaveCSS("overflow", "hidden");
  await expect(scrollport).toHaveCSS("padding-left", "84px");
  await expect(scrollport).toHaveCSS("padding-top", "76px");
  await expect(scrollport).toHaveCSS("padding-bottom", "136px");
  await page.waitForTimeout(250);
  expect(await heading.boundingBox()).toEqual(contentBox);
  const controlsBox = await controls.boundingBox();

  const scrollGeometry = await scrollport.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      bottom: box.bottom,
      clientHeight: element.clientHeight,
      right: box.right,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(scrollGeometry.right).toBe(1200);
  expect(scrollGeometry.bottom).toBe(600);
  expect(scrollGeometry.scrollHeight).toBeGreaterThan(scrollGeometry.clientHeight);

  const dock = page.locator("[data-shell-dock]");
  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(dockBox!.y).toBeLessThan(scrollGeometry.bottom);
  await expect(dock).toBeInViewport();

  await scrollport.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect.poll(() => scrollport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => ({
      body: document.body.scrollTop,
      document: document.documentElement.scrollTop,
      window: globalThis.scrollY,
    })),
  ).toEqual({ body: 0, document: 0, window: 0 });
  expect(await controls.boundingBox()).toEqual(controlsBox);

  await scrollport.evaluate((element) => element.scrollTo({ top: 0 }));
  await page.getByRole("searchbox", { name: "Search everything" }).click();
  const launcherDialog = page.getByRole("dialog", { name: "Start something new" });
  await expect(launcherDialog).toBeVisible();
  await expect(launcherDialog).not.toHaveAttribute("aria-modal", "true");
  await expect(surface).not.toHaveAttribute("inert", "");
  await expect(surface).not.toHaveAttribute("aria-hidden", "true");

  await page.mouse.move(600, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scrollport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(launcherDialog).toBeVisible();
});

test("closing a Vibe moves it from the active slot into the recent rail", async ({ page }) => {
  await page.goto("/vibes");

  const slot = page.locator("[data-dock-app-slot]");
  const content = page.locator("[data-dock-app-content]");
  const traySlot = page.locator("[data-dock-tray-slot]");
  const runningApps = page.locator("[data-dock-running-apps]");
  await expect(slot).toHaveAttribute("data-present", "true");
  await expect(slot).toHaveCSS("position", "absolute");
  await expect(traySlot).toHaveCSS("transition-property", "margin-left");
  await expect(traySlot).toHaveCSS("transition-duration", "0.1s");
  await expect(traySlot).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await expect(content).toHaveCSS("transition-duration", "0.1s");

  await traySlot.evaluate((element) => {
    element.addEventListener("transitionrun", (event) => {
      const transition = event as TransitionEvent;
      if (transition.target !== element || transition.propertyName !== "margin-left") return;
      element.setAttribute("data-test-transition-property", transition.propertyName);
    });
  });
  const motion = await sampleLauncherXWhileClicking(page, "Close surface");

  await expect(page).toHaveURL(/\/$/);
  expectMonotonicMotion(motion, "decreasing");
  expect((motion.at(-1) as number) - (motion[0] as number)).toBeCloseTo(-36, 0);
  await expect(slot).toHaveAttribute("data-present", "false");
  await expect(traySlot).toHaveAttribute("data-test-transition-property", "margin-left");
  await expect(content).toHaveCSS("opacity", "0");
  await expect(traySlot).toHaveCSS("margin-left", "0px");
  await expect.poll(() => slot.boundingBox()).toMatchObject({ width: 68, height: 68 });
  await expect(runningApps).toHaveAttribute("data-count", "1");
  await expect(runningApps).toHaveCSS("width", "44px");
  await expect(page.getByRole("button", { name: "Vibes", exact: true })).toHaveCount(1);
  await expect(page.locator("[data-surface-window]")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const persisted = sessionStorage.getItem("rhizome.shell");
        if (!persisted) return [];
        return (JSON.parse(persisted) as { state?: { open?: unknown[] } }).state?.open ?? [];
      }),
    )
    .toEqual([]);
});

test("opening and traversing to a new surface replaces the previous window", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button", { name: `Open object ${OBJECT_URI}` }).click();

  const editor = page.getByLabel("User properties, as JSON");
  await expect(editor).toBeVisible();
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await editor.fill('{"reviewed":"draft"}');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(editor).toHaveCount(0);
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(JSON.stringify({ reviewed: false }, null, 2));
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
});

test("Vibe CRUD and membership use the existing Store object", async ({ page }) => {
  await page.goto("/vibes");
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();

  const newVibeTitle = page.getByLabel("New Vibe title");
  const createVibe = page.getByRole("button", { name: "Create Vibe" });
  const titleBox = await newVibeTitle.boundingBox();
  const createBox = await createVibe.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(createBox).not.toBeNull();
  expect(titleBox!.width).toBeGreaterThan(200);
  expect(titleBox!.x + titleBox!.width).toBeLessThan(createBox!.x);

  await newVibeTitle.fill("Trip planning");
  await createVibe.click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${NEW_VIBE_ID}$`));
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect(
    page.locator("[data-dock-recent-vibes]").getByRole("button", { name: "Vibes", exact: true }),
  ).toBeVisible();

  const title = page.getByLabel("Vibe title", { exact: true });
  await expect(title).toHaveValue("Trip planning");
  await title.fill("Summer trip");
  await page.getByRole("button", { name: "Rename Vibe" }).click();
  await page.getByRole("button", { name: "Home" }).click();
  const renamedVibe = page.getByRole("button", { name: "Open Vibe Summer trip" });
  await expect(renamedVibe).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Vibe Trip planning" })).toHaveCount(0);
  await renamedVibe.click();

  await page.getByLabel("Object URI").fill(OBJECT_URI);
  await page.getByRole("button", { name: "Add object" }).click();
  const object = page.getByRole("button", { name: `Open object ${OBJECT_URI}` });
  await expect(object).toBeVisible();

  await page.getByRole("button", { name: `Remove ${OBJECT_URI} from Vibe` }).click();
  await expect(object).toBeHidden();
  await expect(page.getByText("This Vibe has no objects yet.")).toBeVisible();

  await page.getByLabel("Object URI").fill(OBJECT_URI);
  await page.getByRole("button", { name: "Add object" }).click();
  await expect(object).toBeVisible();

  await page.getByRole("button", { name: "Home" }).click();
  await expect(renamedVibe).toContainText("1 objects");
  await renamedVibe.click();

  await page.getByRole("button", { name: "Delete Vibe" }).click();
  await page.getByRole("button", { name: "Confirm delete Vibe" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("searchbox", { name: "Search everything" }).click();
  await expect(page.getByRole("button", { name: "Summer trip", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Spending", exact: true })).toBeVisible();

  await page.goto("/vibes");
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Vibe Summer trip" })).toHaveCount(0);
});

test("a granted Vibe is browseable without exposing owner-only controls", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "rhizome.session",
      JSON.stringify({ state: { token: "dev:user:other" }, version: 0 }),
    );
  });
  await page.goto(`/vibes/${VIBE_ID}`);

  await expect(page.getByRole("button", { name: `Open object ${OBJECT_URI}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename Vibe" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Vibe" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add object" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Remove ${OBJECT_URI} from Vibe` })).toHaveCount(0);

  await page.getByRole("button", { name: `Open object ${OBJECT_URI}` }).click();
  await expect(page.getByRole("button", { name: "Save user properties" })).toHaveCount(0);
  await expect(page.getByText('"reviewed": false')).toBeVisible();
});

test("an owner can refresh configured sources and see the deduplication result", async ({
  page,
}) => {
  await page.goto(`/vibes/${VIBE_ID}`);

  await page.getByRole("button", { name: "Refresh sources" }).click();
  const pullSummary = page
    .getByRole("status")
    .filter({ hasText: "Checked 1 candidates · added 0" });
  await expect(pullSummary).toContainText("Checked 1 candidates · added 0");
  await expect(pullSummary).toContainText("1 already known · 0 new objects");

  const pullRequest = mockStore.requests.find(
    (request) =>
      request.method() === "POST" && request.url().endsWith(`/rnet/v0/vibes/${VIBE_ID}/pull`),
  );
  expect(pullRequest?.postDataJSON()).toEqual({});
});

test("user-property edits survive a reload", async ({ page }) => {
  await page.goto(`/objects/${OBJECT_ID}`);

  const editor = page.getByLabel("User properties, as JSON");
  await editor.fill(JSON.stringify({ reviewed: true, category: "budget" }, null, 2));
  await page.getByRole("button", { name: "Save user properties" }).click();
  await expect(page.getByText("saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(editor).toHaveValue(JSON.stringify({ reviewed: true, category: "budget" }, null, 2));
});

test("typing during a user-property save preserves the newer draft", async ({ page }) => {
  const releaseWrite = mockStore.holdNextUserWrite();
  await page.goto(`/objects/${OBJECT_ID}`);

  const editor = page.getByLabel("User properties, as JSON");
  const save = page.getByRole("button", { name: /Save user properties|Saving…/ });
  const submitted = JSON.stringify({ reviewed: true }, null, 2);
  const newer = JSON.stringify({ reviewed: true, note: "typed while saving" }, null, 2);

  await editor.fill(submitted);
  await save.click();
  await expect(save).toBeDisabled();

  await editor.fill(newer);
  await expect(save).toBeDisabled();
  releaseWrite();

  await expect(save).toBeEnabled();
  await expect(editor).toHaveValue(newer);
  await expect(page.getByText("saved", { exact: true })).toHaveCount(0);
});

test("an existing element payload is fetched and presented", async ({ page }) => {
  const payloadResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/elements/${ELEMENT_ID}/bytes`),
  );
  await page.goto(`/objects/${OBJECT_ID}`);
  await payloadResponse;

  const preview = page.getByTitle("Monthly plan");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveCSS("color-scheme", "light");
  await expect(preview.contentFrame().locator("body")).toContainText(PAYLOAD_TEXT.trim());
  const download = page.getByRole("link", { name: `Download payload ${ELEMENT_URI}` });
  await download.scrollIntoViewIfNeeded();
  await expect(download).toBeInViewport();
  await expect(download).toHaveAttribute("href", /^blob:/);
});

test("an image payload remains decodable when its previewing surface is replaced", async ({
  page,
}) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const element = mockStore.elements.get(ELEMENT_ID);
  if (!element) throw new Error("Missing seeded element");
  element.kind = "image";
  element.mime = "image/png";
  element.byte_size = png.byteLength;
  mockStore.elementPayloads.set(ELEMENT_ID, png);

  await page.goto(`/vibes/${VIBE_ID}`);
  const preview = page.getByRole("img", { name: "Monthly plan" });
  await expect
    .poll(() => preview.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const previewUrl = await preview.getAttribute("src");

  await page.getByRole("button", { name: `Open object ${OBJECT_URI}` }).click();

  const image = page.getByRole("img", { name: "Monthly plan" });
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("border-top-width", "1px");
  await expect(image).toHaveCSS("border-top-color", "oklab(0 0 0 / 0.1)");
  await expect(image).toHaveCSS("border-top-left-radius", "0px");
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(image).not.toHaveAttribute("src", previewUrl ?? "");
});

test("home opens the Vibes surface from the bare desktop", async ({ page }) => {
  await page.goto("/");
  const tray = page.locator("[data-dock-tray]");
  const slot = page.locator("[data-dock-app-slot]");
  const traySlot = page.locator("[data-dock-tray-slot]");
  const trayBox = await tray.boundingBox();
  await expect(slot).toHaveAttribute("data-present", "false");
  await expect(traySlot).toHaveCSS("transition-property", "margin-left");
  await expect(traySlot).toHaveCSS("margin-left", "0px");
  await page.getByRole("button", { name: /home/i }).click();
  await expect(slot).toHaveAttribute("data-present", "true");
  await expect(traySlot).toHaveCSS("margin-left", "80px");
  await expect
    .poll(() => tray.boundingBox())
    .toMatchObject({ y: trayBox!.y, height: trayBox!.height });
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(
    page.getByRole("button", { name: "Vibes", exact: true }).locator("[data-dock-app-label]"),
  ).toHaveText("Vibes");
  const activeAppSurface = page
    .getByRole("button", { name: "Vibes", exact: true })
    .locator("[data-dock-app-surface]");
  await expect(activeAppSurface).toHaveCSS(
    "background-color",
    "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  await expect(activeAppSurface).toHaveCSS("backdrop-filter", "blur(10px)");
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();
});

test("opening a Vibe keeps the Vibes index available as the previous dock window", async ({
  page,
}) => {
  await page.goto("/vibes");
  await page.getByRole("button", { name: "Open Vibe Spending" }).click();

  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  const rail = page.locator("[data-dock-recent-vibes]");
  await expect(rail).toHaveAttribute("data-count", "1");
  await rail.getByRole("button", { name: "Vibes", exact: true }).click();

  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect(rail.getByRole("button", { name: "Spending", exact: true })).toBeVisible();
});

test("the Vibes index participates in the same three-item MRU rail as individual Vibes", async ({
  page,
}) => {
  const baseVibe = mockStore.vibes[0];
  if (!baseVibe) throw new Error("Missing seeded Vibe");
  const priorVibes = [
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd3", "Library"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd4", "Trip planning"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd5", "Reading list"],
  ] as const;
  mockStore.vibes.push(
    ...priorVibes.map(([uuid, title]): Vibe => ({
      ...structuredClone(baseVibe),
      uri: `rnet://vibe/${uuid}`,
      title,
    })),
  );

  for (const [uuid] of priorVibes) {
    await page.goto(`/vibes/${uuid}`);
    await expect(page).toHaveURL(new RegExp(`/vibes/${uuid}$`));
    await expect(page.locator("[data-surface-window]")).toHaveAttribute(
      "data-surface-id",
      `vibe:${uuid}`,
    );
  }
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator("[data-surface-window]")).toHaveAttribute("data-surface-id", "vibes");
  await page.getByRole("button", { name: "Open Vibe Spending" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.locator("[data-surface-window]")).toHaveAttribute(
    "data-surface-id",
    `vibe:${VIBE_ID}`,
  );

  const rail = page.locator("[data-dock-recent-vibes]");
  const items = rail.getByRole("button");
  await expect(rail).toHaveAttribute("data-count", "4");
  await expect(rail).toHaveCSS("width", "172px");
  expect(await items.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    "Vibes",
    "Reading list",
    "Trip planning",
    "Library",
  ]);

  const geometry = await rail.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    const vibesButton = [...element.querySelectorAll("button")].find(
      (button) => button.ariaLabel === "Vibes",
    );
    if (!vibesButton) throw new Error("Missing recent Vibes dock item");
    const vibesBox = vibesButton.getBoundingClientRect();
    return {
      scrollLeft: element.scrollLeft,
      vibesLeft: vibesBox.left,
      vibesRight: vibesBox.right,
      viewportLeft: viewport.left,
      viewportRight: viewport.right,
    };
  });
  expect(geometry.scrollLeft).toBe(0);
  expect(geometry.vibesLeft).toBeGreaterThanOrEqual(geometry.viewportLeft);
  expect(geometry.vibesRight).toBeLessThanOrEqual(geometry.viewportRight);
});

test("opening a surface grows its dock icon into the window", async ({ page }) => {
  await installDockOpenAnimationProbe(page);
  await page.goto("/");

  const home = page.getByRole("button", { name: "Home", exact: true });
  await home.hover();
  await expect
    .poll(() => home.evaluate((element) => getComputedStyle(element).translate))
    .toBe("0px -2px");
  const sourceRect = await home.boundingBox();
  expect(sourceRect).not.toBeNull();
  await home.click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect
    .poll(async () => (await readDockOpenAnimationProbe(page)).length)
    .toBeGreaterThanOrEqual(2);

  const animationCount = (await readDockOpenAnimationProbe(page)).length;
  const records = (await readDockOpenAnimationProbe(page)).slice(-2);
  const surface = records.find((record) => record.target === "surface");
  const content = records.find((record) => record.target === "content");
  expect(surface).toMatchObject({
    source: "home",
    surfaceId: "vibes",
    target: "surface",
    timing: {
      delay: null,
      duration: 200,
      easing: "cubic-bezier(0.2, 0.9, 0.2, 1.04)",
      fill: "both",
    },
  });
  expect(surface?.keyframes).toHaveLength(2);
  expect(surface?.keyframes[0]).toMatchObject({
    clipPath: "inset(0 round 999px)",
    offset: null,
    opacity: null,
  });
  expect(surface?.keyframes[0]?.transform).toMatch(/^translate3d\(.+\) scale\(.+\)$/);
  expect(surface?.keyframes[1]).toEqual({
    clipPath: "inset(0 round 20px)",
    offset: null,
    opacity: null,
    transform: "translate3d(0, 0, 0) scale(1, 1)",
  });
  if (sourceRect) expectOriginToMatch(surface?.origin ?? null, sourceRect);
  expect(surface?.targetRect.width).toBeGreaterThan(sourceRect?.width ?? 0);
  expect(surface?.targetRect.height).toBeGreaterThan(sourceRect?.height ?? 0);

  expect(content).toMatchObject({
    source: "home",
    surfaceId: "vibes",
    target: "content",
    timing: {
      delay: 12,
      duration: 180,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "both",
    },
  });
  expect(content?.keyframes).toEqual([
    { clipPath: null, offset: 0, opacity: 0, transform: null },
    { clipPath: null, offset: 0.18, opacity: 0, transform: null },
    { clipPath: null, offset: 0.55, opacity: 0.35, transform: null },
    { clipPath: null, offset: 1, opacity: 1, transform: null },
  ]);
  await expect
    .poll(async () => (await readDockOpenAnimationProbe(page)).every((record) => record.finished))
    .toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-surface-id="vibes"][data-view-mode]')).toBeHidden();
  await page.goForward();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator('[data-surface-id="vibes"][data-view-mode]')).toBeVisible();
  expect(await readDockOpenAnimationProbe(page)).toHaveLength(animationCount);
});

test("dock opening skips shared motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDockOpenAnimationProbe(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator('[data-surface-id="vibes"][data-view-mode]')).toBeVisible();
  await expect(page.locator("[data-surface-opening]")).toHaveCount(0);
  expect(await readDockOpenAnimationProbe(page)).toEqual([]);
});

for (const launcherCase of [
  {
    label: "Open Vibes",
    query: "",
    section: "Commands",
    surfaceId: "vibes",
    url: /\/vibes$/,
  },
  {
    label: "Spending",
    query: "spend",
    section: "Vibes",
    surfaceId: `vibe:${VIBE_ID}`,
    url: new RegExp(`/vibes/${VIBE_ID}$`),
  },
] as const) {
  test(`${launcherCase.label} grows from the launcher into its window`, async ({ page }) => {
    await installDockOpenAnimationProbe(page);
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: /search everything/i });
    await search.click();
    if (launcherCase.query) await search.fill(launcherCase.query);
    const sourceRect = await page.locator("[data-launcher-slot]").boundingBox();
    expect(sourceRect).not.toBeNull();
    await page
      .locator(`[data-launcher-section="${launcherCase.section}"]`)
      .getByRole("button", { name: launcherCase.label, exact: true })
      .click();

    await expect(page).toHaveURL(launcherCase.url);
    await expect
      .poll(async () => (await readDockOpenAnimationProbe(page)).length)
      .toBeGreaterThanOrEqual(2);
    const records = (await readDockOpenAnimationProbe(page)).slice(-2);
    const surface = records.find((record) => record.target === "surface");
    expect(surface).toMatchObject({
      source: "launcher",
      surfaceId: launcherCase.surfaceId,
      target: "surface",
      timing: {
        duration: 200,
        easing: "cubic-bezier(0.2, 0.9, 0.2, 1.04)",
        fill: "both",
      },
    });
    if (sourceRect) expectOriginToMatch(surface?.origin ?? null, sourceRect);
    expect(surface?.keyframes[0]?.clipPath).toBe("inset(0 round 999px)");
    expect(surface?.keyframes[1]?.transform).toBe("translate3d(0, 0, 0) scale(1, 1)");
    await expect
      .poll(async () => (await readDockOpenAnimationProbe(page)).every((record) => record.finished))
      .toBe(true);
  });
}

test("selecting the already-focused window does not animate", async ({ page }) => {
  await installDockOpenAnimationProbe(page);
  await page.goto(`/vibes/${VIBE_ID}`);

  const search = page.getByRole("searchbox", { name: /search everything/i });
  await search.click();
  await search.fill("spend");
  await page
    .locator('[data-launcher-section="Vibes"]')
    .getByRole("button", { name: "Spending", exact: true })
    .click();

  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.getByRole("dialog", { name: /start something new/i })).toHaveCount(0);
  expect(await readDockOpenAnimationProbe(page)).toEqual([]);
});

test("a running surface becomes active without reversing the dock motion", async ({ page }) => {
  await installDockOpenAnimationProbe(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect
    .poll(async () => (await readDockOpenAnimationProbe(page)).length)
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(async () => (await readDockOpenAnimationProbe(page)).every((record) => record.finished))
    .toBe(true);
  const initialAnimationCount = (await readDockOpenAnimationProbe(page)).length;
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  const runningApps = page.locator("[data-dock-running-apps]");
  await expect(runningApps).toHaveAttribute("data-count", "1");
  await expect(runningApps).toHaveCSS("width", "44px");
  await expect(runningApps).toHaveCSS("transition-property", "width");
  await expect(runningApps).toHaveCSS("transition-duration", "0.1s");
  await expect(runningApps).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  const runningApp = runningApps.getByRole("button", { name: "Vibes", exact: true });
  const runningLabel = runningApp.locator("[data-dock-app-label]");
  await expect(runningLabel).toHaveText("Vibes");
  await expect(runningLabel).toHaveCSS("opacity", "0");
  await runningApp.hover();
  await expect(runningLabel).toHaveCSS("opacity", "1");
  await expect(runningApp).toHaveCSS("translate", "0px -5px");
  await expect(runningLabel).toHaveCSS("font-weight", "600");
  const sourceRect = await runningApp.boundingBox();
  expect(sourceRect).not.toBeNull();

  const motion = await sampleLauncherXWhileClicking(page, "Vibes");

  await expect(page).toHaveURL(/\/vibes$/);
  await expect
    .poll(async () => (await readDockOpenAnimationProbe(page)).length)
    .toBeGreaterThan(initialAnimationCount);
  const runningSurface = (await readDockOpenAnimationProbe(page))
    .slice(initialAnimationCount)
    .find((record) => record.target === "surface");
  expect(runningSurface).toMatchObject({
    source: "running",
    surfaceId: "vibes",
    target: "surface",
    timing: { duration: 200 },
  });
  if (sourceRect) expectOriginToMatch(runningSurface?.origin ?? null, sourceRect);
  expectMonotonicMotion(motion, "increasing");
  expect((motion.at(-1) as number) - (motion[0] as number)).toBeCloseTo(36, 0);
  await expect(runningApps).toHaveAttribute("data-count", "0");
  await expect(runningApps).toHaveCSS("width", "0px");
  const activeLabel = page.locator("[data-dock-app-slot] [data-dock-app-label]");
  await expect(activeLabel).toHaveText("Vibes");
  await expect(activeLabel).toHaveCSS("font-weight", "600");
});

test("the dock keeps an MRU Vibe rail with three scrollbar-free visible items", async ({
  page,
}) => {
  const baseVibe = mockStore.vibes[0];
  if (!baseVibe) throw new Error("Missing seeded Vibe");
  const extraVibes = [
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd3", "Library"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd4", "Trip planning"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd5", "Reading list"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd6", "Recipes"],
  ] as const;
  mockStore.vibes.push(
    ...extraVibes.map(([uuid, title]): Vibe => ({
      ...structuredClone(baseVibe),
      uri: `rnet://vibe/${uuid}`,
      title,
    })),
  );

  const openedVibes = [[VIBE_ID, "Spending"], ...extraVibes] as const;
  await page.goto("/vibes");
  await page.getByRole("button", { name: "Open Vibe Spending" }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);

  for (const [uuid, title] of openedVibes.slice(1)) {
    const search = page.getByRole("searchbox", { name: /search everything/i });
    await search.click();
    await search.fill(title);
    await page
      .locator('[data-launcher-section="Vibes"]')
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/vibes/${uuid}$`));
    await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  }

  const rail = page.locator("[data-dock-recent-vibes]");
  const items = rail.getByRole("button");
  await expect(rail).toHaveAttribute("data-count", "5");
  await expect(items).toHaveCount(5);
  expect(await items.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    "Reading list",
    "Trip planning",
    "Library",
    "Spending",
    "Vibes",
  ]);
  await expect(rail.getByRole("button", { name: "Recipes", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-dock-app-slot] [aria-current="true"]')).toHaveAccessibleName(
    "Recipes",
  );

  const geometry = await rail.evaluate((element) => {
    const itemBoxes = [...element.querySelectorAll("button")].map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, x: box.x };
    });
    return {
      clientWidth: element.clientWidth,
      itemBoxes,
      scrollbarWidth: getComputedStyle(element).getPropertyValue("scrollbar-width"),
      scrollWidth: element.scrollWidth,
      webkitScrollbarDisplay: getComputedStyle(element, "::-webkit-scrollbar").display,
    };
  });
  expect(geometry.clientWidth).toBe(172);
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
  expect(geometry.itemBoxes.map(({ width }) => width)).toEqual([44, 44, 44, 44, 44]);
  expect(
    geometry.itemBoxes.slice(1).map((box, index) => box.x - geometry.itemBoxes[index]!.x),
  ).toEqual([64, 64, 64, 64]);
  expect(geometry.scrollbarWidth).toBe("none");
  expect(geometry.webkitScrollbarDisplay).toBe("none");

  await rail.evaluate((element) => {
    element.scrollTo({ left: element.scrollWidth });
  });
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await rail.getByRole("button", { name: "Spending", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(items.first()).toHaveAccessibleName("Recipes");
  expect(await items.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    "Recipes",
    "Reading list",
    "Trip planning",
    "Library",
    "Vibes",
  ]);
});

test("launcher sections scroll horizontally beyond three items", async ({ page }) => {
  const baseVibe = mockStore.vibes[0];
  if (!baseVibe) throw new Error("Missing seeded Vibe");
  const extraVibes = [
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd3", "Library"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd4", "Trip planning"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd5", "Reading list"],
    ["0198f2a1-a09b-76aa-95d8-fc5b55b41fd6", "Recipes"],
  ] as const;
  mockStore.vibes.push(
    ...extraVibes.map(([uuid, title]): Vibe => ({
      ...structuredClone(baseVibe),
      uri: `rnet://vibe/${uuid}`,
      title,
    })),
  );
  await page.goto("/");
  await page.getByRole("searchbox", { name: /search everything/i }).click();

  const rail = page.locator('[data-launcher-section="Vibes"] [data-launcher-item-rail]');
  const items = rail.locator("button");
  await expect(items).toHaveCount(5);
  const dimensions = await rail.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollbarWidth: getComputedStyle(element).getPropertyValue("scrollbar-width"),
    scrollWidth: element.scrollWidth,
    webkitScrollbarDisplay: getComputedStyle(element, "::-webkit-scrollbar").display,
  }));
  expect(dimensions.clientWidth).toBe(260);
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(dimensions.scrollbarWidth).toBe("none");
  expect(dimensions.webkitScrollbarDisplay).toBe("none");

  const itemYs = await items.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().y),
  );
  expect(Math.max(...itemYs) - Math.min(...itemYs)).toBeLessThan(0.5);
  await rail.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("launcher search opens a loaded Vibe by title", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /home/i }).click();
  const launcher = page.getByRole("searchbox", { name: /search everything/i });
  const container = page.locator("[data-launcher-container]");
  const expandedContent = page.locator("[data-launcher-results]");
  const launcherBlur = page.locator("[data-launcher-blur]");
  const launcherSurface = page.locator("[data-launcher-surface]");
  const launcherInputRow = page.locator("[data-launcher-input-row]");
  const itemRails = page.locator("[data-launcher-item-rail]");
  const slot = page.locator("[data-launcher-slot]");
  await expect(page.locator('[data-launcher-section="Commands"]')).toHaveCount(1);
  await expect(page.locator('[data-launcher-section="Vibes"]')).toHaveCount(1);
  await expect(page.locator('[data-launcher-section="Open surfaces"]')).toHaveCount(0);
  await expect(page.locator("[data-dock-tray-slot]")).toHaveCSS("margin-left", "80px");
  await expect(page.getByRole("button", { name: /start something new/i })).toHaveCount(0);
  await expect(container).toHaveAttribute("data-expanded", "false");
  await expect(container).toHaveCSS("width", "240px");
  await expect(container).toHaveCSS("transition-property", "width");
  await expect(container).toHaveCSS("transition-duration", "0.1s");
  await expect(container).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await expect(expandedContent).toHaveCSS("width", "308px");
  await expect(itemRails.first()).toHaveCSS("display", "flex");
  await expect(itemRails.first()).toHaveCSS("flex-wrap", "nowrap");
  await expect(itemRails.first()).toHaveCSS("overflow-x", "auto");
  await expect.poll(() => itemRails.first().boundingBox()).toMatchObject({ width: 260 });
  await expect(expandedContent).toHaveCSS("opacity", "0");
  await expect(launcherSurface).toHaveCSS("background-color", "rgba(255, 255, 250, 0.9)");
  await expect(launcherSurface).toHaveCSS("opacity", "1");
  await expect(launcherBlur).toHaveCSS("backdrop-filter", "blur(20px)");
  await expect(launcherBlur).toHaveCSS("opacity", "1");
  await expect(launcherSurface).toHaveCSS("clip-path", "none");
  await expect(launcherSurface).not.toHaveCSS("mask-image", "none");
  expect(
    await launcherSurface.evaluate((element) => getComputedStyle(element).maskImage),
  ).toContain("closest-side");
  await expect
    .poll(() =>
      launcherSurface.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--rz-launcher-expanded-alpha").trim(),
      ),
    )
    .toBe("0");
  await expect(expandedContent).toHaveCSS("transition-duration", "0.1s");
  await expect(expandedContent).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0.4, 0, 1, 1)",
  );
  await expect(launcherSurface).toHaveCSS(
    "transition-property",
    "--rz-launcher-expanded-alpha, opacity",
  );
  await expect(launcherSurface).toHaveCSS("transition-duration", "0.1s");
  await expect(launcherSurface).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0.4, 0, 1, 1)",
  );
  await expect(slot).toHaveCSS("width", "240px");
  await expect(page.locator("[data-launcher-backdrops]")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-dock-tray]")).toHaveCSS("transition-duration", "0.1s");
  await launcher.evaluate((element) => {
    element.dataset.testInstance = "original";
  });
  const inputBox = await launcher.boundingBox();
  const resultItems = expandedContent.locator("button");
  const closedItemBoxes = await resultItems.evaluateAll((items) =>
    items.slice(0, 3).map((item) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }),
  );
  const collapsedBackground = await launcherSurface.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const radius = await launcherSurface.evaluate(
    (element) => getComputedStyle(element).borderRadius,
  );

  await launcherSurface.evaluate((element) => {
    element.addEventListener("transitionrun", (event) => {
      const transition = event as TransitionEvent;
      if (
        transition.target !== element ||
        transition.propertyName !== "--rz-launcher-expanded-alpha"
      )
        return;
      element.setAttribute("data-test-transition-property", transition.propertyName);
    });
  });
  await launcher.click();
  await expect(container).toHaveAttribute("data-expanded", "true");
  await expect(expandedContent).toHaveCSS("opacity", "1");
  await expect(expandedContent).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0, 0, 0.2, 1)",
  );
  await expect(launcherSurface).toHaveCSS("background-color", "rgba(255, 255, 250, 0.9)");
  await expect(launcherSurface).toHaveCSS("opacity", "1");
  await expect(launcherBlur).toHaveCSS("backdrop-filter", "blur(24px)");
  await expect(launcherBlur).toHaveCSS("opacity", "1");
  await expect(launcherSurface).toHaveCSS(
    "transition-timing-function",
    "cubic-bezier(0, 0, 0.2, 1)",
  );
  await expect(launcherSurface).toHaveAttribute(
    "data-test-transition-property",
    "--rz-launcher-expanded-alpha",
  );
  await expect
    .poll(() =>
      launcherSurface.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--rz-launcher-expanded-alpha").trim(),
      ),
    )
    .toBe("1");
  await expect(page.getByRole("dialog", { name: /start something new/i })).toBeVisible();
  await expect(launcher).toHaveAttribute("data-test-instance", "original");
  await expect(container).toHaveCSS("width", "308px");
  await expect(expandedContent).toHaveCSS("width", "308px");
  await expect
    .poll(() =>
      resultItems.evaluateAll((items) =>
        items.slice(0, 3).map((item) => {
          const box = item.getBoundingClientRect();
          return { x: box.x, y: box.y };
        }),
      ),
    )
    .toEqual(closedItemBoxes);
  await expect.poll(() => launcherSurface.boundingBox()).toMatchObject({ width: 308 });
  await expect(slot).toHaveCSS("width", "240px");
  await expect
    .poll(() => launcher.boundingBox())
    .toMatchObject({ x: inputBox!.x, y: inputBox!.y, height: inputBox!.height });
  await expect
    .poll(() => launcherSurface.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(255, 255, 250, 0.9)");
  await expect
    .poll(() => launcherSurface.evaluate((element) => getComputedStyle(element).borderRadius))
    .toBe(radius);

  await launcher.fill("spend");
  await expect(page.locator('[data-launcher-section="Vibes"]')).toBeVisible();
  const [closeSamples] = await Promise.all([
    page.evaluate(async () => {
      const inputRow = document.querySelector<HTMLElement>("[data-launcher-input-row]");
      const container = document.querySelector<HTMLElement>("[data-launcher-container]");
      const surface = document.querySelector<HTMLElement>("[data-launcher-surface]");
      const results = document.querySelector<HTMLElement>("[data-launcher-results]");
      if (!container || !inputRow || !surface || !results)
        throw new Error("Launcher geometry is unavailable");
      const sampledContainer = container;
      const sampledInputRow = inputRow;
      const sampledSurface = surface;
      const sampledResults = results;

      const samples: Array<{
        alpha: number;
        clipPath: string;
        containerWidth: number;
        resultsOpacity: number;
        row: { height: number; width: number; x: number; y: number };
        surface: { height: number; y: number };
      }> = [];
      const stopAt = performance.now() + 180;
      await new Promise<void>((resolve) => {
        function sample() {
          const rowBox = sampledInputRow.getBoundingClientRect();
          const containerBox = sampledContainer.getBoundingClientRect();
          const surfaceBox = sampledSurface.getBoundingClientRect();
          const surfaceStyle = getComputedStyle(sampledSurface);
          samples.push({
            alpha: Number(surfaceStyle.getPropertyValue("--rz-launcher-expanded-alpha")),
            clipPath: surfaceStyle.clipPath,
            containerWidth: containerBox.width,
            resultsOpacity: Number(getComputedStyle(sampledResults).opacity),
            row: { height: rowBox.height, width: rowBox.width, x: rowBox.x, y: rowBox.y },
            surface: { height: surfaceBox.height, y: surfaceBox.y },
          });
          if (performance.now() < stopAt) requestAnimationFrame(sample);
          else resolve();
        }
        sample();
      });
      return samples;
    }),
    launcher.press("Escape"),
  ]);
  await expect(container).toHaveAttribute("data-expanded", "false");
  await expect(container).toHaveCSS("width", "240px");
  await expect(launcher).toHaveAttribute("data-test-instance", "original");
  await expect.poll(() => launcher.boundingBox()).toEqual(inputBox);
  await expect
    .poll(() => launcherSurface.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(collapsedBackground);
  await expect.poll(() => launcherInputRow.boundingBox()).toMatchObject({ width: 240, height: 48 });
  await expect(launcher).not.toBeFocused();

  const firstSample = closeSamples[0];
  expect(firstSample).toBeDefined();
  for (const sample of closeSamples) {
    expect(sample.clipPath).toBe("none");
    expect(sample.row).toEqual(firstSample!.row);
    expect(sample.surface).toEqual(firstSample!.surface);
  }
  expect(closeSamples.some(({ alpha }) => alpha > 0 && alpha < 1)).toBe(true);
  expect(
    closeSamples.some(({ containerWidth }) => containerWidth > 240 && containerWidth < 308),
  ).toBe(true);
  expect(closeSamples.some(({ resultsOpacity }) => resultsOpacity > 0 && resultsOpacity < 1)).toBe(
    true,
  );
  for (let index = 1; index < closeSamples.length; index += 1) {
    expect(closeSamples[index]!.alpha).toBeLessThanOrEqual(closeSamples[index - 1]!.alpha + 0.001);
    expect(closeSamples[index]!.containerWidth).toBeLessThanOrEqual(
      closeSamples[index - 1]!.containerWidth + 0.1,
    );
    expect(closeSamples[index]!.resultsOpacity).toBeLessThanOrEqual(
      closeSamples[index - 1]!.resultsOpacity + 0.001,
    );
  }

  await launcher.click();
  await expect(launcher).toHaveAttribute("data-test-instance", "original");
  await page.locator("[data-dock-tray]").click({ position: { x: 600, y: 32 } });
  await expect(container).toHaveAttribute("data-expanded", "false");

  await launcher.click();
  await launcher.fill("spend");
  await launcher.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(container).toHaveAttribute("data-expanded", "false");
  await expect(launcher).not.toBeFocused();

  await launcher.click();
  await launcher.fill("spend");
  await page
    .locator('[data-launcher-section="Vibes"]')
    .getByRole("button", { name: "Spending", exact: true })
    .click();
  await expect(launcherSurface).toHaveCSS("transition-property", "none");
  await expect(expandedContent).toHaveCSS("transition-property", "none");
  await expect(container).toHaveCSS("transition-property", "none");
  await expect(container).toHaveAttribute("data-expanded", "false");
  await expect(container).toHaveCSS("width", "240px");
  await expect(slot).toHaveCSS("width", "240px");
  await expect(launcher).not.toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
});
