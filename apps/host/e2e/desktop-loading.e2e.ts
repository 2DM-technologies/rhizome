import { expect, test } from "@playwright/test";
import { installMockStore, OBJECT_ID } from "./support/mockStore.ts";

test("the stacked desktop remains wheel-scrollable between lg and xl", async ({ page }) => {
  const store = await installMockStore(page);
  const base = store.vibes[0]!;
  store.vibes.splice(
    0,
    store.vibes.length,
    ...Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(base),
      uri: `rnet://vibe/0198f2a1-1401-7501-8501-${String(index + 1).padStart(12, "0")}`,
      title: `Vibe ${index + 1}`,
    })),
  );
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/");
  const home = page.locator("[data-desktop-home]");
  await expect(home.locator("[data-desktop-vibe-card]")).toHaveCount(20);
  await home.hover({ position: { x: 8, y: 8 } });
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => home.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(home.locator("[data-desktop-vibe-card]").last()).toBeInViewport();
});

test("desktop cards defer collection and payload requests until scrolled into view", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const baseVibe = structuredClone(store.vibes[0]!);
  const baseObject = structuredClone(store.objects.get(OBJECT_ID)!);
  const baseElement = structuredClone([...store.elements.values()][0]!);
  store.vibes.splice(0);
  const elementIds: string[][] = [];
  const vibeIds: string[] = [];
  for (let index = 0; index < 30; index++) {
    const vibeId = `0198f2a1-1401-7501-8501-${String(index + 1).padStart(12, "0")}`;
    const objectUris: string[] = [];
    const previews: string[] = [];
    for (let preview = 0; preview < 6; preview++) {
      const suffix = String(index * 6 + preview + 1).padStart(12, "0");
      const objectId = `0198f2a1-1402-7501-8501-${suffix}`;
      const elementId = `0198f2a1-1403-7501-8501-${suffix}`;
      const elementUri = `rnet://element/${elementId}`;
      const objectUri = `rnet://object/${objectId}`;
      store.elements.set(elementId, { ...structuredClone(baseElement), uri: elementUri });
      store.elementPayloads.set(elementId, Buffer.from("Small local test payload"));
      store.objects.set(objectId, {
        ...structuredClone(baseObject),
        uri: objectUri,
        elements: [{ uri: elementUri }],
      });
      objectUris.push(objectUri);
      previews.push(elementId);
    }
    elementIds.push(previews);
    vibeIds.push(vibeId);
    store.vibes.push({
      ...structuredClone(baseVibe),
      uri: `rnet://vibe/${vibeId}`,
      title: `Card ${index}`,
      objects: objectUris,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const cards = page.locator("[data-desktop-vibe-card]");
  await expect(cards).toHaveCount(30);
  const requested = (path: string) =>
    store.requests.some((request) => new URL(request.url()).pathname === path);
  await expect(cards.first().locator('[data-element-presentation="text"]')).toHaveCount(5);
  expect(requested(`/rnet/v0/vibes/${vibeIds[29]}/objects`)).toBe(false);
  for (const id of elementIds[29]!) {
    expect(requested(`/rnet/v0/elements/${id}`)).toBe(false);
    expect(requested(`/rnet/v0/elements/${id}/bytes`)).toBe(false);
  }
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last().locator('[data-element-presentation="text"]')).toHaveCount(5);
  await expect(cards.last().getByText("+1", { exact: true })).toBeVisible();
  expect(requested(`/rnet/v0/vibes/${vibeIds[29]}/objects`)).toBe(true);
  for (const id of elementIds[29]!.slice(0, 5))
    expect(requested(`/rnet/v0/elements/${id}/bytes`)).toBe(true);
  const hiddenElement = elementIds[29]![5]!;
  expect(requested(`/rnet/v0/elements/${hiddenElement}`)).toBe(false);
  expect(requested(`/rnet/v0/elements/${hiddenElement}/bytes`)).toBe(false);
});

test("unsupported desktop previews show a placeholder without downloading their payload", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const object = store.objects.get(OBJECT_ID)!;
  const elementId = object.elements[0]!.uri.split("/").at(-1)!;
  const element = store.elements.get(elementId)!;
  element.kind = "audio";
  element.mime = "audio/mpeg";
  await page.goto("/");
  const thumbnail = page.locator("[data-desktop-vibe-card] [data-object-thumbnail]");
  await expect(thumbnail).toHaveText("a");
  expect(
    store.requests.some(
      (request) => new URL(request.url()).pathname === `/rnet/v0/elements/${elementId}/bytes`,
    ),
  ).toBe(false);
});
