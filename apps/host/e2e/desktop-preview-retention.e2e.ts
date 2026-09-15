import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ELEMENT_ID, installMockStore } from "./support/mockStore.ts";

for (const kind of ["small text", "large text", "video"] as const) {
  test(`desktop ${kind} preview stays bounded across repeated Home reveals`, async ({ page }) => {
    const store = await installMockStore(page);
    const bytes =
      kind === "video"
        ? await readFile(new URL("./fixtures/tweetfeed.webm", import.meta.url))
        : Buffer.from(kind === "large text" ? "x".repeat(16 * 1024 + 1) : "A cached text preview.");
    store.elements.set(ELEMENT_ID, {
      ...store.elements.get(ELEMENT_ID)!,
      kind: kind === "video" ? "video" : "text",
      mime: kind === "video" ? "video/webm" : "text/plain",
      byte_size: bytes.length,
    });
    let downloads = 0;
    await page.route(`**/rnet/v0/elements/${ELEMENT_ID}/bytes`, async (route) => {
      downloads++;
      expect(route.request().headers().authorization).toBe("Bearer dev:user");
      await route.fulfill({
        status: 200,
        contentType: kind === "video" ? "video/webm" : "text/plain",
        headers: { "Cache-Control": "private, no-store" },
        body: bytes,
      });
    });
    const metadata = page.waitForResponse((response) =>
      response.url().endsWith(`/elements/${ELEMENT_ID}`),
    );
    await page.goto("/");
    await metadata;
    const preview = page.locator("[data-desktop-home] [data-object-thumbnail]").first();
    const assertPreview = async () => {
      await expect(preview).toBeVisible();
      await expect(preview).toHaveText(
        kind === "small text" ? bytes.toString() : kind === "video" ? "v" : "t",
      );
      await expect(preview.locator("video")).toHaveCount(0);
      expect(downloads).toBe(kind === "small text" ? 1 : 0);
    };
    await assertPreview();
    for (let reveal = 0; reveal < 3; reveal++) {
      await page
        .getByRole("region", { name: "Pinned apps" })
        .getByRole("button", { name: "Vibes", exact: true })
        .click();
      await expect(preview).toBeHidden();
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await assertPreview();
    }
  });
}
