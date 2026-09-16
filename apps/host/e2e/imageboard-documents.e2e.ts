import { expect, test } from "@playwright/test";

import { ELEMENT_ID, installMockStore, OBJECT_URI, VIBE_ID } from "./support/mockStore.ts";

test("imageboard document cards load the full PDF only when opened", async ({ page }) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  vibe.inferred = {
    "rhizome:vibe-view": {
      model: "mock/rhizome",
      properties: { view: "mediaboard", config: { caption_pointer: null } },
    },
  };
  const element = store.elements.get(ELEMENT_ID)!;
  store.elements.set(ELEMENT_ID, { ...element, kind: "document", mime: "application/pdf" });
  let payloadRequests = 0;
  await page.route(`**/rnet/v0/elements/${ELEMENT_ID}/bytes`, async (route) => {
    payloadRequests++;
    await route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/vibes/${VIBE_ID}`);
  const card = page.getByLabel("Inferred Vibe view").locator("[data-media-object-card]");
  await expect(card.getByText("Document", { exact: true })).toBeVisible();
  await expect(card.locator("object, iframe, embed")).toHaveCount(0);
  await expect(card).not.toContainText("Loading content");
  expect(payloadRequests).toBe(0);

  await card.getByRole("button", { name: `Open object ${OBJECT_URI}`, exact: true }).click();
  await expect(
    page.getByRole("link", { name: `Download payload rnet://element/${ELEMENT_ID}` }),
  ).toHaveAttribute("href", /^blob:/);
  expect(payloadRequests).toBe(1);
});
