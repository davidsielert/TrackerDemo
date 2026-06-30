import test from "node:test";
import assert from "node:assert/strict";
import { clearData, findVisitorIdByFingerprint, getState, insertEvent } from "./db.js";

test("stores accepted events and creates a simulated partner mapping", () => {
  clearData();
  insertEvent({
    visitor_id: "demo_tracker_test",
    site_name: "news.localhost",
    page_url: "http://news.localhost/",
    referrer: null,
    timestamp: new Date().toISOString(),
    user_agent: "test",
    browser_language: "en-US",
    screen_width: 1440,
    screen_height: 900,
    timezone: "America/Los_Angeles",
    cookie_enabled: 1,
    do_not_track: null,
    consent_status: "accepted",
    fingerprint_hash: "abc123",
    fingerprint_confidence: 88,
    tracking_method: "JavaScript tracker",
    request_type: "POST fetch",
    event_name: "page_view",
    relinked_by_fingerprint: 0,
    event_type: "page_view"
  });
  const state = getState();
  assert.equal(state.events.length, 1);
  assert.equal(state.mappings.length, 1);
  assert.equal(findVisitorIdByFingerprint("abc123"), "demo_tracker_test");
});
