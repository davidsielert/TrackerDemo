import { expect, test, type APIRequestContext } from "@playwright/test";

const demoPort = process.env.DEMO_PORT ?? "";
const portSuffix = demoPort ? `:${demoPort}` : "";
const trackerOrigin = `http://tracker.localhost${portSuffix}`;

type EventRow = {
  visitor_id: string | null;
  site_name: string;
  tracking_method: string;
  request_type: string;
  event_name: string;
  event_type: string;
  fingerprint_hash: string | null;
  relinked_by_fingerprint: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  zip_code: string | null;
  plan_interest: string | null;
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
  await page.addInitScript(() => {
    const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      return `${location.hostname}:${originalToDataUrl.apply(this, args)}`;
    };
  });

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
  const fingerprintHashes = new Set(pageViews.map((event) => event.fingerprint_hash));
  const methods = new Set(pageViews.map((event) => event.tracking_method));
  const sites = new Set(pageViews.map((event) => event.site_name));

  expect(visitorIds.size).toBe(1);
  expect(visitorIds.has(null)).toBe(false);
  expect(fingerprintHashes.size).toBe(1);
  expect(fingerprintHashes.has(null)).toBe(false);
  expect(sites).toEqual(new Set(["news.localhost", "weather.localhost", "shop.localhost"]));
  expect(methods).toEqual(new Set(["JavaScript tracker", "Image pixel beacon", "sendBeacon API"]));

  await page.goto(`http://dashboard.localhost${portSuffix}/`);
  await expect(page.getByRole("columnheader", { name: "Request type" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Fingerprint hash" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Tracking method" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Visitor ID" })).toBeVisible();
  const sameProfilePanel = page.getByTestId("same-profile-panel");
  await expect(sameProfilePanel.getByTestId("method-profile")).toHaveCount(1);
  await expect(sameProfilePanel.getByTestId("method-line-news")).toContainText("seen");
  await expect(sameProfilePanel.getByTestId("method-line-weather")).toContainText("seen");
  await expect(sameProfilePanel.getByTestId("method-line-shop")).toContainText("seen");
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

test("lead form uses local pixel-style requests and gates risky fake PII by consent", async ({ page, request }) => {
  await resetDemo(request);
  const requestedUrls: string[] = [];
  page.on("request", (pageRequest) => requestedUrls.push(pageRequest.url()));

  await page.goto(`http://lead-form.localhost${portSuffix}/`);
  await expect(page.locator("[data-demo-tracker-banner]")).toHaveCount(0);

  const safePixel = page.waitForRequest((pageRequest) => pageRequest.url().includes("/api/pixel") && pageRequest.url().includes("LeadSubmitted"));
  await page.getByRole("button", { name: "Submit fake lead" }).click();
  const safePixelUrl = new URL((await safePixel).url());
  expect(safePixelUrl.searchParams.get("tracking_method")).toBe("Local pixel-style lead tag");
  expect(safePixelUrl.searchParams.get("request_type")).toBe("GET image pixel");
  expect(safePixelUrl.searchParams.has("first_name")).toBe(false);
  expect(safePixelUrl.searchParams.has("email")).toBe(false);

  await expect.poll(async () => {
    const pollResponse = await request.get(`${trackerOrigin}/api/state`);
    const pollState = await pollResponse.json() as State;
    return pollState.events.filter((event) => event.event_type === "lead_submitted").length;
  }).toBe(1);

  let response = await request.get(`${trackerOrigin}/api/state`);
  let state = await response.json() as State;
  const safeEvent = state.events.find((event) => event.event_type === "lead_submitted");
  expect(safeEvent?.request_type).toBe("GET image pixel");
  expect(safeEvent?.first_name).toBeNull();
  expect(safeEvent?.email).toBeNull();

  await request.delete(`${trackerOrigin}/api/events`);
  await request.patch(`${trackerOrigin}/api/config`, {
    data: { cmpEnabled: true }
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Reject tracking" })).toBeVisible();
  await page.getByRole("button", { name: "Reject tracking" }).click();
  await page.getByRole("button", { name: "Risky PII mode" }).click();
  await page.getByRole("button", { name: "Submit fake lead" }).click();
  response = await request.get(`${trackerOrigin}/api/state`);
  state = await response.json() as State;
  expect(state.events.filter((event) => event.event_type === "lead_submitted")).toHaveLength(0);

  await page.getByRole("button", { name: "Accept tracking" }).click();
  const riskyPixel = page.waitForRequest((pageRequest) => pageRequest.url().includes("/api/pixel") && pageRequest.url().includes("avery.parker%40example.test"));
  await page.getByRole("button", { name: "Submit fake lead" }).click();
  const riskyPixelUrl = new URL((await riskyPixel).url());
  expect(riskyPixelUrl.searchParams.get("first_name")).toBe("Avery");
  expect(riskyPixelUrl.searchParams.get("email")).toBe("avery.parker@example.test");
  expect(riskyPixelUrl.searchParams.get("phone")).toBe("555-010-2048");

  await expect.poll(async () => {
    const pollResponse = await request.get(`${trackerOrigin}/api/state`);
    const pollState = await pollResponse.json() as State;
    return pollState.events.filter((event) => event.event_type === "lead_submitted").length;
  }).toBe(1);

  await page.goto(`http://dashboard.localhost${portSuffix}/`);
  await expect(page.getByText("PII Risk Demo")).toBeVisible();
  await expect(page.getByText("High risk")).toBeVisible();
  await expect(page.getByText("First name PII")).toBeVisible();
  await expect(page.getByText("Email PII")).toBeVisible();

  expect(requestedUrls.some((url) => url.includes("/tracker.js"))).toBe(false);
});

test("demo hub presents the guided slide flow and can reset data", async ({ page, context, request }) => {
  await resetDemo(request);
  await request.patch(`${trackerOrigin}/api/config`, {
    data: { cmpEnabled: true }
  });

  await page.goto(`http://demo.localhost${portSuffix}/`);

  await expect(page.getByText("Slide 1 of 11")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cross-context tracking turns scattered visits into a profile" })).toBeVisible();
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
  await expect(page.getByText("Key Ideas").first()).toBeVisible();
  await expect(page.getByText("Takeaway:").first()).toBeVisible();
  await expect(page.getByText("Speaker Notes").first()).toBeVisible();
  await expect(page.getByText("What the presenter should do")).toHaveCount(0);
  await expect(page.getByText("What the audience should notice")).toHaveCount(0);
  await expect(page.getByText("Expected Result")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open All Demo Sites" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reset Demo Data" })).toHaveCount(1);

  const existingPages = new Set(context.pages());
  await page.getByRole("button", { name: "Open All Demo Sites" }).first().click();
  await expect(page.locator("[data-launcher]")).toBeVisible();
  await expect(page.locator("[data-launcher]")).toContainText("If a popup blocker interferes");
  await expect(page.locator("[data-launcher-links] a")).toHaveCount(4);
  await expect(page.locator("[data-launcher-links] a", { hasText: "News" })).toHaveAttribute("href", `http://news.localhost${portSuffix}/`);
  await expect(page.locator("[data-launcher-links] a", { hasText: "Weather" })).toHaveAttribute("href", `http://weather.localhost${portSuffix}/`);
  await expect(page.locator("[data-launcher-links] a", { hasText: "Shop" })).toHaveAttribute("href", `http://shop.localhost${portSuffix}/`);
  await expect(page.locator("[data-launcher-links] a", { hasText: "Lead Form" })).toHaveAttribute("href", `http://lead-form.localhost${portSuffix}/`);
  await expect.poll(() => context.pages().filter((contextPage) => !existingPages.has(contextPage)).length).toBe(4);
  const openedPages = context.pages().filter((contextPage) => !existingPages.has(contextPage));
  await Promise.all(openedPages.map((openedPage) => openedPage.waitForLoadState("domcontentloaded")));
  expect(new Set(openedPages.map((openedPage) => new URL(openedPage.url()).hostname))).toEqual(
    new Set(["news.localhost", "weather.localhost", "shop.localhost", "lead-form.localhost"])
  );
  await Promise.all(openedPages.map((openedPage) => openedPage.close()));

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Slide 2 of 11")).toBeVisible();
  await expect(page.getByText("A script tag can turn a page view into structured telemetry")).toBeVisible();

  await page.getByRole("button", { name: "Reset Demo Data" }).first().click();
  await expect(page.getByText("Demo data reset. CMP gate is disabled.")).toBeVisible();

  const response = await request.get(`${trackerOrigin}/api/config`);
  const config = await response.json() as { cmpEnabled: boolean };
  expect(config.cmpEnabled).toBe(false);
});
