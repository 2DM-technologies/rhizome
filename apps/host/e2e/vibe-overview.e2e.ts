import { expect, test } from "@playwright/test";
import { installMockStore, OBJECT_ID, VIBE_ID } from "@rhizome/test-support/mockStore";

test("summary polls task state and shares a row with inferred above the view", async ({ page }) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  const original = store.objects.get(OBJECT_ID)!;
  vibe.objects = Array.from({ length: 14 }, (_, index) => {
    const uuid = `0198f2a1-1401-7501-8501-${String(index + 1).padStart(12, "0")}`;
    const object = { ...original, uri: `rnet://object/${uuid}` };
    store.objects.set(uuid, object);
    return object.uri;
  });
  vibe.inferred = {
    "rhizome:vibe_view": {
      model: "mock/rhizome",
      properties: { view: "simplelist", config: { subtitle_pointer: null } },
    },
  };
  let status = "waiting";
  let revision = 1;
  await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("level")).toBe("vibe");
    const task = url.searchParams.get("task");
    expect(["summarize", "vibe_view"]).toContain(task);
    return route.fulfill({
      json: {
        level: "vibe",
        task,
        status: task === "summarize" ? status : "idle",
        revision,
        message: task === "summarize" && status === "error" ? "interrupted" : null,
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/vibes/${VIBE_ID}`);
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  const skeleton = page.getByLabel("Summary loading");
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator(".inferred-skeleton-line")).toHaveCount(2);
  await expect(skeleton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(skeleton).toHaveCSS("padding", "0px");
  await expect(summary).not.toHaveClass(/border/);
  status = "running";
  await expect(skeleton).toHaveAttribute("data-inference-state", "waiting");
  status = "error";
  await expect(summary.getByRole("alert")).toHaveText("interrupted");
  await expect(skeleton).toHaveCount(0);
  status = "running";
  await expect(skeleton).toBeVisible();
  vibe.inferred["rhizome:summarize"] = {
    model: "mock/rhizome",
    properties: { summary: "A refreshed collection." },
  };
  status = "done";
  revision = 2;
  await expect(summary).toContainText("A refreshed collection.");
  await expect(skeleton).toHaveCount(0);
  await expect(summary.getByRole("alert")).toHaveCount(0);
  const layout = await page.getByLabel("Vibe overview", { exact: true }).evaluate((container) => {
    const bounds = container.getBoundingClientRect();
    const left = container.children[0]!.getBoundingClientRect();
    const right = container.children[1]!.getBoundingClientRect();
    const view = container
      .parentElement!.querySelector('[data-vibe-view="simplelist"]')!
      .getBoundingClientRect();
    return {
      bottom: bounds.bottom,
      left: { width: left.width, top: left.top },
      right: { width: right.width, top: right.top },
      viewTop: view.top,
    };
  });
  expect(layout.left.width).toBeCloseTo(layout.right.width, 0);
  expect(layout.left.top).toBeCloseTo(layout.right.top, 0);
  expect(layout.viewTop).toBeGreaterThanOrEqual(layout.bottom);
  await expect(
    page
      .getByLabel("Vibe overview", { exact: true })
      .locator(":scope > div")
      .getByRole("button", { name: "Import into this Vibe", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 600, height: 900 });
  const stacked = await page.getByLabel("Vibe overview", { exact: true }).evaluate((container) => {
    const left = container.children[0]!.getBoundingClientRect();
    const right = container.children[1]!.getBoundingClientRect();
    return right.top >= left.bottom;
  });
  expect(stacked).toBe(true);
});

test("tweets retain their original centered reading width below the overview", async ({ page }) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  const original = store.objects.get(OBJECT_ID)!;
  vibe.objects = Array.from({ length: 10 }, (_, index) => {
    const uuid = `0198f2a1-1401-7501-8501-${String(index + 101).padStart(12, "0")}`;
    const object = { ...original, type: "tweet", uri: `rnet://object/${uuid}`, elements: [] };
    store.objects.set(uuid, object);
    return object.uri;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/vibes/${VIBE_ID}`);
  await expect(page.getByLabel("Tweet feed").locator(":scope > li")).toHaveCount(10);
  const sizes = await page.getByLabel("Tweet feed").evaluate((container) => {
    const bounds = container.parentElement!.getBoundingClientRect();
    const overview = container
      .closest("section")!
      .parentElement!.querySelector('[aria-label="Vibe overview"]')!
      .getBoundingClientRect();
    const rows = container.querySelectorAll("[data-tweet-object]");
    const first = rows[0]!.getBoundingClientRect();
    const last = rows[rows.length - 1]!.getBoundingClientRect();
    return {
      width: bounds.width,
      left: bounds.left,
      overviewBottom: overview.bottom,
      firstTop: first.top,
      firstWidth: first.width,
      firstLeft: first.left,
      lastWidth: last.width,
      lastLeft: last.left,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    };
  });
  expect(sizes.firstTop).toBeGreaterThanOrEqual(sizes.overviewBottom);
  expect(sizes.firstWidth).toBeCloseTo(sizes.lastWidth, 0);
  expect(sizes.lastWidth).toBeLessThanOrEqual(sizes.rem * 42);
  expect(sizes.firstLeft).toBeCloseTo(sizes.left + (sizes.width - sizes.firstWidth) / 2, 0);
  expect(sizes.lastLeft).toBeCloseTo(sizes.firstLeft, 0);
  await page.screenshot({ path: "/tmp/rhizome-vibe-overview.png" });
});

test("Vibe inferred uses object-page skeleton progression across summary and view tasks", async ({
  page,
}) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  vibe.inferred = {};
  const statuses: Record<string, string> = { summarize: "waiting", vibe_view: "waiting" };
  let revision = 1;
  await page.route("**/rnet/v0/vibes/*/inference-status?*", (route) => {
    const task = new URL(route.request().url()).searchParams.get("task")!;
    return route.fulfill({
      json: {
        level: "vibe",
        task,
        status: statuses[task],
        revision,
        message: statuses[task] === "error" ? "View inference failed" : null,
      },
    });
  });
  await page.goto(`/vibes/${VIBE_ID}`);
  const inferred = page.getByLabel("Vibe inferred", { exact: true });
  const block = inferred.locator(".inferred-block");
  await expect(block).toHaveAttribute("data-inference-state", "waiting");
  await expect(inferred.locator(".inferred-skeleton-line")).toHaveCount(12);
  statuses.summarize = "running";
  await expect(block).toHaveAttribute("data-inference-state", "running");
  const runningBackground = await block.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  statuses.summarize = "done";
  vibe.inferred = {
    "rhizome:summarize": { model: "mock/rhizome", properties: { summary: "An updated summary." } },
  };
  revision = 2;
  await expect(block).toHaveAttribute("data-inference-state", "waiting");
  await expect(inferred.locator("pre")).toContainText("An updated summary.");
  await expect(inferred.locator(".inferred-skeleton-line")).toHaveCount(0);
  expect(await block.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    runningBackground,
  );
  statuses.vibe_view = "running";
  await expect(block).toHaveAttribute("data-inference-state", "running");
  await expect(inferred.locator("pre")).toContainText("An updated summary.");
  statuses.vibe_view = "error";
  await expect(block).toHaveAttribute("data-inference-state", "idle");
  await expect(inferred.getByRole("alert")).toHaveText("View inference failed");
  statuses.vibe_view = "running";
  await expect(block).toHaveAttribute("data-inference-state", "running");
  await expect(inferred.getByRole("alert")).toHaveCount(0);
  statuses.vibe_view = "done";
  await expect(block).toHaveAttribute("data-inference-state", "idle");
  await expect(block).toHaveAttribute("aria-busy", "false");
});

test("imageboard keeps 48px between rows and 20px between columns", async ({ page }) => {
  const store = await installMockStore(page);
  const vibe = store.vibes.find((item) => item.uri.endsWith(VIBE_ID))!;
  const object = store.objects.get(OBJECT_ID)!;
  vibe.objects = Array.from({ length: 6 }, () => object.uri);
  vibe.inferred = {
    "rhizome:vibe_view": {
      model: "mock/rhizome",
      properties: { view: "mediaboard", config: { caption_pointer: null } },
    },
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/vibes/${VIBE_ID}`);
  const board = page.getByLabel("Inferred Vibe view");
  await expect(board.locator("[data-media-object-card]")).toHaveCount(6);
  const gaps = await board.evaluate((element) => {
    const cards = [...element.querySelectorAll("[data-media-object-card] > article")].map((card) =>
      card.getBoundingClientRect(),
    );
    const nextRow = cards.find((card) => card.top > cards[0]!.top + 1)!;
    return { row: nextRow.top - cards[0]!.bottom, column: cards[1]!.left - cards[0]!.right };
  });
  expect(gaps.row).toBeCloseTo(48, 0);
  expect(gaps.column).toBeCloseTo(20, 0);
});
