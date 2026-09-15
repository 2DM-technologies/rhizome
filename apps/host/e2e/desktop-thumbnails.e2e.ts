import { expect, test } from "@playwright/test";

import { ELEMENT_ID, installMockStore } from "./support/mockStore.ts";

// A 64x64 WebP fixture. Image processing is exercised by the server's thumbnail tests.
const THUMBNAIL = Buffer.from(
  "UklGRkYAAABXRUJQVlA4IDoAAACQAwCdASpAAEAAPpFIoEwlpCMiIggAsBIJaQAAEDdTUAV4hbkAAP7Qyv//nEv/1t/8f9nwl4AAAAAA",
  "base64",
);

for (const available of [true, false]) {
  test(`desktop image previews ${available ? "fetch only the small thumbnail" : "keep a placeholder when a thumbnail is unavailable"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1728, height: 1117 });
    const store = await installMockStore(page);
    const element = store.elements.get(ELEMENT_ID)!;
    store.elements.set(ELEMENT_ID, { ...element, kind: "image", mime: "image/jpeg" });
    let thumbnailRequests = 0;
    const originalRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(`/elements/${ELEMENT_ID}/bytes`)) {
        originalRequests.push(request.url());
      }
    });
    await page.route(`**/rnet/v0/elements/${ELEMENT_ID}/thumbnail`, async (route) => {
      thumbnailRequests++;
      expect(route.request().headers().authorization).toBe("Bearer dev:user");
      await route.fulfill({
        status: available ? 200 : 404,
        contentType: available ? "image/webp" : "application/problem+json",
        body: available ? THUMBNAIL : JSON.stringify({ code: "not_found" }),
      });
    });
    const response = page.waitForResponse((result) => result.url().endsWith("/thumbnail"));
    await page.goto("/");
    await response;
    const preview = page.locator("[data-desktop-vibe-card] [data-object-thumbnail]").first();
    await expect(preview).toBeVisible();
    if (available) {
      const image = preview.locator("img");
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((node) => {
            if (!(node instanceof HTMLImageElement)) throw new Error("Expected an image");
            return [node.naturalWidth, node.naturalHeight];
          }),
        )
        .toEqual([64, 64]);
      await expect(image).toHaveCSS("width", "18px");
    } else {
      await expect(preview.locator("img")).toHaveCount(0);
      await expect(preview).toHaveText("i");
    }
    expect(thumbnailRequests).toBe(1);
    expect(originalRequests).toEqual([]);
  });
}
