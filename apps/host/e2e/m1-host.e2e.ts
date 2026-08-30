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

async function installViewTransitionProbe(page: Page) {
  await page.addInitScript(() => {
    const nativeStartViewTransition = document.startViewTransition.bind(document);
    const records: Array<{
      before: Array<{
        ariaLabel: string | null;
        name: string;
        source: string | null;
        surfaceId: string | null;
        tagName: string;
        target: boolean;
      }>;
      after: Array<{
        ariaLabel: string | null;
        name: string;
        source: string | null;
        surfaceId: string | null;
        tagName: string;
        target: boolean;
      }>;
      animations: Array<{ duration: number | string | null; pseudoElement: string | null }>;
      oldOpacity: string | null;
      ready: boolean;
      readyError: string | null;
      finished: boolean;
    }> = [];

    function participants() {
      return [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]
        .map((element) => ({ element, name: getComputedStyle(element).viewTransitionName }))
        .filter(({ name }) => name.startsWith("rz-surface-"))
        .map(({ element, name }) => ({
          ariaLabel: element.getAttribute("aria-label"),
          name,
          source: element.dataset.surfaceTransitionSource ?? null,
          surfaceId: element.dataset.surfaceId ?? null,
          tagName: element.tagName,
          target: element.hasAttribute("data-surface-transition-target"),
        }));
    }

    document.startViewTransition = ((callbackOptions) => {
      const update =
        typeof callbackOptions === "function" ? callbackOptions : callbackOptions?.update;
      const record: (typeof records)[number] = {
        before: participants(),
        after: [],
        animations: [],
        oldOpacity: null,
        ready: false,
        readyError: null,
        finished: false,
      };
      records.push(record);

      const wrappedUpdate = async () => {
        await update?.();
        record.after = participants();
      };
      const transition = nativeStartViewTransition(
        typeof callbackOptions === "function"
          ? wrappedUpdate
          : { ...callbackOptions, update: wrappedUpdate },
      );

      void transition.ready.then(
        () => {
          record.ready = true;
          const transitionName = record.before[0]?.name;
          record.oldOpacity = transitionName
            ? getComputedStyle(document.documentElement, `::view-transition-old(${transitionName})`)
                .opacity
            : null;
          record.animations = document.getAnimations().flatMap((animation) => {
            const effect = animation.effect;
            if (!(effect instanceof KeyframeEffect)) return [];
            const duration = effect.getTiming().duration;
            return [
              {
                duration:
                  typeof duration === "number" || typeof duration === "string"
                    ? duration
                    : (duration?.toString() ?? null),
                pseudoElement: effect.pseudoElement,
              },
            ];
          });
        },
        (error: unknown) => {
          record.readyError = String(error);
        },
      );
      void transition.finished.then(
        () => {
          record.finished = true;
        },
        () => {
          record.finished = true;
        },
      );
      return transition;
    }) as Document["startViewTransition"];

    Object.defineProperty(window, "__rhizomeViewTransitions", { value: records });
  });
}

function readViewTransitionProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __rhizomeViewTransitions: Array<{
            before: Array<{
              ariaLabel: string | null;
              name: string;
              source: string | null;
              surfaceId: string | null;
              tagName: string;
              target: boolean;
            }>;
            after: Array<{
              ariaLabel: string | null;
              name: string;
              source: string | null;
              surfaceId: string | null;
              tagName: string;
              target: boolean;
            }>;
            animations: Array<{ duration: number | string | null; pseudoElement: string | null }>;
            oldOpacity: string | null;
            ready: boolean;
            readyError: string | null;
            finished: boolean;
          }>;
        }
      ).__rhizomeViewTransitions,
  );
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
  await expect(dockTrayBackdrop).toHaveCSS("background-color", "rgba(221, 221, 221, 0.5)");
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

  await page.getByRole("button", { name: "Geometry", exact: true }).click();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await page.waitForTimeout(250);

  // Old standard history entries are normalized to the inherited mode without adding history.
  await page.goBack();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-surface-id", "vibes");
  await page.waitForTimeout(250);
  await page.goBack();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-surface-id", "m:Geometry");
  await expect(activeSurface).toHaveAttribute("data-view-mode", "maximized");
  await page.getByRole("button", { name: "Vibes", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-surface-id", "vibes");

  // Closing and reloading the bare desktop do not implicitly reset the persisted mode.
  await activeSurface.getByRole("button", { name: "Close surface" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await page.getByRole("button", { name: "Geometry", exact: true }).click();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);
  await expect(activeSurface).toHaveAttribute("data-view-mode", "maximized");

  await activeSurface.getByRole("button", { name: "Restore window" }).click();
  await expect(page).toHaveURL(/\/m\/Geometry$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
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

test("closing a surface animates its dock icon out", async ({ page }) => {
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
  expect((motion.at(-1) as number) - (motion[0] as number)).toBeCloseTo(-80, 0);
  await expect(slot).toHaveAttribute("data-present", "false");
  await expect(traySlot).toHaveAttribute("data-test-transition-property", "margin-left");
  await expect(content).toHaveCSS("opacity", "0");
  await expect(traySlot).toHaveCSS("margin-left", "0px");
  await expect.poll(() => slot.boundingBox()).toMatchObject({ width: 68, height: 68 });
  await expect(runningApps).toHaveAttribute("data-count", "0");
  await expect(runningApps).toHaveCSS("width", "0px");
  await expect(page.getByRole("button", { name: "Vibes", exact: true })).toHaveCount(0);
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

test("back and forward focus surfaces without remounting their local state", async ({ page }) => {
  await page.goto(`/vibes/${VIBE_ID}`);
  await page.getByRole("button").filter({ hasText: OBJECT_URI }).click();

  const editor = page.getByLabel("User properties, as JSON");
  await expect(editor).toBeVisible();
  await editor.fill('{"reviewed":"draft"}');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/vibes/${VIBE_ID}$`));
  await expect(editor).toBeHidden();
  await expect(editor).toHaveValue('{"reviewed":"draft"}');

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT_ID}$`));
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('{"reviewed":"draft"}');
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
  await expect(page.getByRole("status")).toContainText("Checked 1 transactions · added 0");
  await expect(page.getByRole("status")).toContainText("1 already known · 0 new records");

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

  const label = `Payload for ${ELEMENT_URI}`;
  const preview = page.getByTitle(label);
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
  const object = mockStore.objects.get(OBJECT_ID);
  if (!element) throw new Error("Missing seeded element");
  if (!object) throw new Error("Missing seeded object");
  element.kind = "image";
  element.mime = "image/png";
  element.byte_size = png.byteLength;
  mockStore.elementPayloads.set(ELEMENT_ID, png);
  object.type = "arena.block";

  await page.goto(`/vibes/${VIBE_ID}`);
  const preview = page.getByRole("img", { name: "Monthly plan" });
  await expect
    .poll(() => preview.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const previewUrl = await preview.getAttribute("src");

  await page.getByRole("button", { name: "Open Are.na block Monthly plan" }).click();

  const image = page.getByRole("img", { name: `Payload for ${ELEMENT_URI}` });
  await expect(image).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Open Vibe Spending" })).toBeVisible();
});

test("opening a surface grows its dock icon into the window", async ({ page }) => {
  await installViewTransitionProbe(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect.poll(async () => (await readViewTransitionProbe(page))[0]?.ready).toBe(true);

  const [record] = await readViewTransitionProbe(page);
  expect(record?.readyError).toBeNull();
  expect(record?.before).toHaveLength(1);
  expect(record?.before[0]).toMatchObject({
    ariaLabel: "Home",
    tagName: "BUTTON",
    target: false,
  });
  expect(record?.after).toHaveLength(1);
  expect(record?.after[0]).toMatchObject({
    surfaceId: "vibes",
    tagName: "DIV",
    target: true,
  });
  expect(record?.after[0]?.name).toBe(record?.before[0]?.name);
  expect(
    record?.animations.some(
      ({ duration, pseudoElement }) =>
        duration === 200 && pseudoElement === `::view-transition-group(${record.before[0]?.name})`,
    ),
  ).toBe(true);
  expect(record?.oldOpacity).toBe("0");
  await expect.poll(async () => (await readViewTransitionProbe(page))[0]?.finished).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => (await readViewTransitionProbe(page)).length).toBe(2);
  const [, historyRecord] = await readViewTransitionProbe(page);
  expect(historyRecord?.before).toEqual([]);
  expect(historyRecord?.after).toEqual([]);
});

test("dock opening skips shared motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installViewTransitionProbe(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator('[data-surface-id="vibes"][data-view-mode]')).toBeVisible();
  expect(await readViewTransitionProbe(page)).toEqual([]);
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
    await installViewTransitionProbe(page);
    await page.goto("/");

    const search = page.getByRole("searchbox", { name: /search everything/i });
    await search.click();
    if (launcherCase.query) await search.fill(launcherCase.query);
    await page
      .locator(`[data-launcher-section="${launcherCase.section}"]`)
      .getByRole("button", { name: launcherCase.label, exact: true })
      .click();

    await expect(page).toHaveURL(launcherCase.url);
    await expect.poll(async () => (await readViewTransitionProbe(page))[0]?.ready).toBe(true);
    const [record] = await readViewTransitionProbe(page);
    expect(record?.before).toHaveLength(1);
    expect(record?.before[0]).toMatchObject({
      source: "launcher",
      tagName: "DIV",
      target: false,
    });
    expect(record?.after).toHaveLength(1);
    expect(record?.after[0]).toMatchObject({
      surfaceId: launcherCase.surfaceId,
      tagName: "DIV",
      target: true,
    });
    expect(record?.after[0]?.name).toBe(record?.before[0]?.name);
    expect(record?.oldOpacity).toBe("0");
    await expect.poll(async () => (await readViewTransitionProbe(page))[0]?.finished).toBe(true);
  });
}

test("selecting the already-focused window does not animate", async ({ page }) => {
  await installViewTransitionProbe(page);
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
  expect(await readViewTransitionProbe(page)).toEqual([]);
});

test("a running surface becomes active without reversing the dock motion", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/vibes$/);
  await expect(page.locator("[data-surface-window]")).toHaveCount(1);
  await expect(page.locator('[data-surface-transition-target="true"]')).toHaveCount(1);
  await expect(page.locator('[data-surface-transition-target="true"]')).toHaveCount(0);
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

  const motion = await sampleLauncherXWhileClicking(page, "Vibes");

  await expect(page).toHaveURL(/\/vibes$/);
  expectMonotonicMotion(motion, "increasing");
  expect((motion.at(-1) as number) - (motion[0] as number)).toBeCloseTo(36, 0);
  await expect(runningApps).toHaveAttribute("data-count", "0");
  await expect(runningApps).toHaveCSS("width", "0px");
  const activeLabel = page.locator("[data-dock-app-slot] [data-dock-app-label]");
  await expect(activeLabel).toHaveText("Vibes");
  await expect(activeLabel).toHaveCSS("font-weight", "600");
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
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.clientWidth).toBe(260);
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);

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
  await expect(launcherSurface).toHaveCSS("background-color", "rgba(26, 26, 26, 0.8)");
  await expect(launcherSurface).toHaveCSS("backdrop-filter", "blur(20px)");
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
    "--rz-launcher-expanded-alpha, background-color",
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
  await expect(launcherSurface).toHaveCSS("background-color", "rgba(26, 26, 26, 0.776)");
  await expect(launcherSurface).toHaveCSS("backdrop-filter", "blur(20px)");
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
    .toBe("rgba(26, 26, 26, 0.776)");
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
