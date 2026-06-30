import cors from "cors";
import express from "express";
import { z } from "zod";
import { clearData, createVisitorId, findVisitorIdByFingerprint, getState, insertEvent, rememberFingerprintIdentity, TrackingEvent } from "./db.js";
import { trackerScript } from "./trackerScript.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const strictConsentMode = (process.env.STRICT_CONSENT_MODE ?? "true") === "true";
let cmpEnabled = (process.env.CMP_ENABLED ?? "false") === "true";
const clients = new Set<express.Response>();

app.use(cors({
  origin: [/^http:\/\/(demo|news|weather|shop|lead-form|dashboard|tracker)\.localhost(?::\d+)?$/],
  credentials: true
}));
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, strictConsentMode, cmpEnabled }));

app.get("/api/config", (_req, res) => res.json({ strictConsentMode, cmpEnabled }));

app.patch("/api/config", (req, res) => {
  const parsed = z.object({ cmpEnabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  cmpEnabled = parsed.data.cmpEnabled;
  const config = { strictConsentMode, cmpEnabled };
  broadcast({ type: "config", config, state: getState() });
  res.json(config);
});

app.get("/tracker.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(trackerScript({ strictConsentMode }));
});

app.get("/api/visitor-id", (req, res) => {
  const cookieId =
    req.headers.cookie?.match(/(?:^|;\s*)demo_tracker_id=([^;]+)/)?.[1] ??
    req.headers.cookie?.match(/(?:^|;\s*)demo_tracker_third_party_id=([^;]+)/)?.[1];
  const fingerprintHash = typeof req.query.fingerprint_hash === "string" ? req.query.fingerprint_hash : null;
  const decodedCookieId = cookieId ? decodeURIComponent(cookieId) : null;
  const fingerprintMatch = fingerprintHash ? findVisitorIdByFingerprint(fingerprintHash) : null;
  const visitorId = fingerprintMatch ?? decodedCookieId ?? createVisitorId();
  const relinkedByFingerprint = Boolean(fingerprintMatch && fingerprintMatch !== decodedCookieId);
  if (fingerprintHash) rememberFingerprintIdentity(fingerprintHash, visitorId);
  res.cookie("demo_tracker_id", visitorId, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.cookie("demo_tracker_third_party_id", visitorId, {
    httpOnly: false,
    sameSite: "none",
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  res.json({
    visitor_id: visitorId,
    relinked_by_fingerprint: relinkedByFingerprint,
    label: "Demo identifier for privacy training only. Not production tracking."
  });
});

const eventSchema = z.object({
  visitor_id: z.string().nullable(),
  site_name: z.string().min(1).max(80),
  page_url: z.string().nullable(),
  referrer: z.string().nullable(),
  timestamp: z.string(),
  user_agent: z.string().nullable(),
  browser_language: z.string().nullable(),
  screen_width: z.number().int().nullable(),
  screen_height: z.number().int().nullable(),
  timezone: z.string().nullable(),
  cookie_enabled: z.boolean().nullable().transform((value) => value === null ? null : Number(value)),
  do_not_track: z.string().nullable(),
  consent_status: z.enum(["unknown", "accepted", "rejected"]),
  fingerprint_hash: z.string().nullable(),
  fingerprint_confidence: z.number().int().min(0).max(100).nullable().optional().transform((value) => value ?? null),
  tracking_method: z.string().min(1).max(80).optional().default("JavaScript tracker"),
  request_type: z.string().min(1).max(80).optional().default("POST fetch"),
  event_name: z.string().min(1).max(80).optional().default("page_view"),
  relinked_by_fingerprint: z.boolean().optional().transform((value) => value ? 1 : 0),
  event_type: z.enum(["page_view", "tracking_blocked", "lead_submitted"]),
  first_name: z.string().max(120).nullable().optional().default(null),
  last_name: z.string().max(120).nullable().optional().default(null),
  email: z.string().max(200).nullable().optional().default(null),
  phone: z.string().max(80).nullable().optional().default(null),
  zip_code: z.string().max(20).nullable().optional().default(null),
  plan_interest: z.string().max(120).nullable().optional().default(null)
});

app.post("/api/events", (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const event = parsed.data as TrackingEvent;
  const saved = insertEvent(event);
  broadcast({ type: "event", event: saved, state: getState() });
  res.status(201).json(saved);
});

app.get("/api/pixel", (req, res) => {
  const parsed = eventSchema.safeParse({
    visitor_id: stringParam(req.query.visitor_id),
    site_name: stringParam(req.query.site_name) ?? "unknown",
    page_url: stringParam(req.query.page_url),
    referrer: stringParam(req.query.referrer),
    timestamp: stringParam(req.query.timestamp) ?? new Date().toISOString(),
    user_agent: stringParam(req.query.user_agent),
    browser_language: stringParam(req.query.browser_language),
    screen_width: numberParam(req.query.screen_width),
    screen_height: numberParam(req.query.screen_height),
    timezone: stringParam(req.query.timezone),
    cookie_enabled: booleanParam(req.query.cookie_enabled),
    do_not_track: stringParam(req.query.do_not_track),
    consent_status: stringParam(req.query.consent_status) ?? "accepted",
    fingerprint_hash: stringParam(req.query.fingerprint_hash),
    fingerprint_confidence: numberParam(req.query.fingerprint_confidence),
    tracking_method: stringParam(req.query.tracking_method) ?? "Image pixel beacon",
    request_type: "GET image pixel",
    event_name: stringParam(req.query.event_name) ?? "page_view",
    relinked_by_fingerprint: booleanParam(req.query.relinked_by_fingerprint) ?? false,
    event_type: stringParam(req.query.event_type) ?? "page_view",
    first_name: stringParam(req.query.first_name),
    last_name: stringParam(req.query.last_name),
    email: stringParam(req.query.email),
    phone: stringParam(req.query.phone),
    zip_code: stringParam(req.query.zip_code),
    plan_interest: stringParam(req.query.plan_interest)
  });

  if (parsed.success) {
    const saved = insertEvent(parsed.data as TrackingEvent);
    broadcast({ type: "event", event: saved, state: getState() });
  }

  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
});

app.get("/api/state", (_req, res) => res.json(getState()));

app.get("/api/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.delete("/api/events", (_req, res) => {
  clearData();
  broadcast({ type: "cleared", state: getState() });
  res.status(204).send();
});

function broadcast(payload: unknown) {
  const message = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(message);
}

app.listen(port, () => {
  console.log(`tracker demo service listening on ${port}`);
});

function stringParam(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberParam(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanParam(value: unknown) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
