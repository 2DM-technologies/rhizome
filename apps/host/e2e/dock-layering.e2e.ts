import { expect, test } from "@playwright/test";

test("a maximized window expands underneath the dock", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeStartViewTransition = document.startViewTransition.bind(document);
    const nativeAnimate = Element.prototype.animate;
    const openingAnimations: Animation[] = [];
    let documentViewTransitionCalls = 0;

    document.startViewTransition = ((callbackOptions) => {
      documentViewTransitionCalls += 1;
      return nativeStartViewTransition(callbackOptions);
    }) as Document["startViewTransition"];

    Element.prototype.animate = function (keyframes, options) {
      const animation = nativeAnimate.call(this, keyframes, options);
      const element = this as HTMLElement;
      if (element.matches("[data-surface-opening]") || element.closest("[data-surface-opening]")) {
        animation.pause();
        openingAnimations.push(animation);
      }
      return animation;
    };

    Object.defineProperty(window, "__rhizomeDocumentViewTransitionCalls", {
      get: () => documentViewTransitionCalls,
    });
    Object.defineProperty(window, "__rhizomePausedOpeningAnimations", {
      value: openingAnimations,
    });
  });

  await page.goto("/m/Geometry");
  const dock = page.locator("[data-shell-dock]");
  const trayBackdrop = page.locator("[data-dock-tray-backdrop]");
  await expect(dock).toHaveCSS("view-transition-name", "none");
  await expect(dock).toHaveCSS("z-index", "20");
  await expect(trayBackdrop).toHaveCSS(
    "background-color",
    "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  await expect(trayBackdrop).toHaveCSS("backdrop-filter", "blur(10px)");

  await page.getByRole("button", { name: "Maximize window" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/m\/Geometry\?mode=maximized$/);

  const openingSurface = page.locator(
    '[data-surface-id="m:Geometry"][data-surface-opening="true"]',
  );
  await expect(openingSurface).toBeVisible();
  await expect(openingSurface).toHaveAttribute("data-surface-opening-source", "home");
  await expect(openingSurface).toHaveCSS("z-index", "auto");
  await expect(dock).toHaveCSS("view-transition-name", "none");
  await expect(trayBackdrop).toHaveCSS(
    "background-color",
    "color(srgb 0.0666667 0.0666667 0.0666667 / 0.9)",
  );
  await expect(trayBackdrop).toHaveCSS("backdrop-filter", "blur(10px)");

  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __rhizomeDocumentViewTransitionCalls: number })
          .__rhizomeDocumentViewTransitionCalls,
    ),
  ).toBe(0);

  const trayBox = await page.locator("[data-dock-tray]").boundingBox();
  expect(trayBox).not.toBeNull();
  if (trayBox) {
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-shell-dock]") !== null,
        { x: trayBox.x + trayBox.width / 2, y: trayBox.y + trayBox.height / 2 },
      ),
    ).toBe(true);
  }

  await page.evaluate(() => {
    (
      window as typeof window & { __rhizomePausedOpeningAnimations: Animation[] }
    ).__rhizomePausedOpeningAnimations.forEach((animation) => animation.finish());
  });
  await expect(openingSurface).toHaveCount(0);
});
