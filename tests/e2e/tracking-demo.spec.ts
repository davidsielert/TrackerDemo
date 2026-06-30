import { expect, test, type APIRequestContext } from "@playwright/test";

const demoPort = process.env.DEMO_PORT ?? "";
const portSuffix = demoPort ? `:${demoPort}` : "";
const trackerOrigin = `http://tracker.localhost${portSuffix}`;

type EventRow = {
  visitor_id: string | null;
  site_name: string;
  tracking_method: string;
  event_type: string;
  relinked_by_fingerprint: number | null;
};

type State = { events: EventRow[] };

async function resetDemo(request: APIRequestContext) {
  await request.delete(`${trackerOrigin}/api/events`);
  await request.patch(`${trackerOrigin}/api/config`, {
    data: { cmpEnabled: false }
  });
}

test("default tracking links News, Weather, and Shop into one backend profile", async ({ page, request }) => {
  await resetDemo(request);

  for (const host of ["news.localhost", "weather.localhost", "shop.localhost"]) {
    await page.goto(`http://${host}${portSuffix}/`);
    await expect(page.locator("[data-demo-tracker-banner]")).toHaveCount(0);
  }

  await expect.poll(async () => {
    const response = await request.get(`${trackerOrigin}/api/state`);
    const state = await response.json() as State;
    return state.events.filter((event) => event.event_type === "page_view").length;
  }).toBe(3);

  const response = await request.get(`${trackerOrigin}/api/state`);
  const state = await response.json() as State;
  const pageViews = state.events.filter((event) => event.event_type === "page_view");
  const visitorIds = new Set(pageViews.map((event) => event.visitor_id));
  const methods = new Set(pageViews.map((event) => event.tracking_method));

  expect(visitorIds.size).toBe(1);
  expect(visitorIds.has(null)).toBe(false);
  expect(methods).toEqual(new Set(["JavaScript tracker", "Image pixel beacon", "sendBeacon API"]));
});

test("tracker issues first-party and third-party demo cookie variants", async ({ request }) => {
  await resetDemo(request);

  const response = await request.get(`${trackerOrigin}/api/visitor-id`, {
    params: { fingerprint_hash: "playwright-cookie-check" }
  });
  const setCookie = response.headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value);

  expect(setCookie.some((cookie) => cookie.startsWith("demo_tracker_id="))).toBe(true);
  expect(setCookie.some((cookie) => cookie.startsWith("demo_tracker_third_party_id="))).toBe(true);
  expect(setCookie.some((cookie) => cookie.startsWith("demo_tracker_third_party_id=") && cookie.includes("SameSite=None"))).toBe(true);
});

test("fingerprint fallback canonicalizes a different partitioned tracker cookie", async ({ request }) => {
  await resetDemo(request);

  const firstResponse = await request.get(`${trackerOrigin}/api/visitor-id`, {
    params: { fingerprint_hash: "playwright-partition-check" }
  });
  const firstIdentity = await firstResponse.json() as { visitor_id: string; relinked_by_fingerprint: boolean };

  const secondResponse = await request.get(`${trackerOrigin}/api/visitor-id`, {
    headers: { cookie: "demo_tracker_id=demo_tracker_partitioned_cookie" },
    params: { fingerprint_hash: "playwright-partition-check" }
  });
  const secondIdentity = await secondResponse.json() as { visitor_id: string; relinked_by_fingerprint: boolean };

  expect(secondIdentity.visitor_id).toBe(firstIdentity.visitor_id);
  expect(secondIdentity.relinked_by_fingerprint).toBe(true);
});

test("CMP mode gates behavioral tracking until accepted", async ({ page, request }) => {
  await resetDemo(request);
  await request.patch(`${trackerOrigin}/api/config`, {
    data: { cmpEnabled: true }
  });

  await page.goto(`http://shop.localhost${portSuffix}/`);
  await expect(page.locator("[data-demo-tracker-banner]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Accept tracking" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject tracking" })).toBeVisible();

  let response = await request.get(`${trackerOrigin}/api/state`);
  let state = await response.json() as State;
  expect(state.events.filter((event) => event.event_type === "page_view")).toHaveLength(0);

  await page.getByRole("button", { name: "Accept tracking" }).click();

  await expect.poll(async () => {
    const pollResponse = await request.get(`${trackerOrigin}/api/state`);
    const pollState = await pollResponse.json() as State;
    return pollState.events.filter((event) => event.site_name === "shop.localhost" && event.event_type === "page_view").length;
  }).toBe(1);

  response = await request.get(`${trackerOrigin}/api/state`);
  state = await response.json() as State;
  expect(state.events.find((event) => event.site_name === "shop.localhost")?.tracking_method).toBe("sendBeacon API");
});

test("demo hub presents the guided slide flow and can reset data", async ({ page, request }) => {
  await request.patch(`${trackerOrigin}/api/config`, {
    data: { cmpEnabled: true }
  });

  await page.goto(`http://demo.localhost${portSuffix}/`);

  await expect(page.getByText("Slide 1 of 11")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview: Cross-context tracking in plain English" })).toBeVisible();
  await expect(page.getByText("Educational simulation only")).toBeVisible();
  await expect(page.getByText("No real ad network, Meta/Facebook pixel, analytics vendor, or external request is used.")).toBeVisible();
  await expect(page.locator(".slide")).toHaveCount(11);
  await expect(page.locator(".statusBadge")).toHaveCount(7);
  await expect(page.getByText("JavaScript tracker").first()).toBeVisible();
  await expect(page.getByText("Pixel beacon").first()).toBeVisible();
  await expect(page.getByText("sendBeacon").first()).toBeVisible();
  await expect(page.getByText("Fingerprinting").first()).toBeVisible();
  await expect(page.getByText("Cookie sync").first()).toBeVisible();
  await expect(page.getByText("Consent blocking").first()).toBeVisible();
  await expect(page.getByText("PII risk").first()).toBeVisible();
  await expect(page.getByText("Expected Result").first()).toBeVisible();
  await expect(page.getByText("Presenter Notes").first()).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Slide 2 of 11")).toBeVisible();
  await expect(page.getByText("JavaScript Tracker: news.localhost")).toBeVisible();

  await page.getByRole("button", { name: "Reset Demo Data" }).first().click();
  await expect(page.getByText("Demo data reset. CMP gate is disabled.")).toBeVisible();

  const response = await request.get(`${trackerOrigin}/api/config`);
  const config = await response.json() as { cmpEnabled: boolean };
  expect(config.cmpEnabled).toBe(false);
});
