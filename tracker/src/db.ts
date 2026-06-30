import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import crypto from "node:crypto";

export type TrackingEvent = {
  id?: number;
  visitor_id: string | null;
  site_name: string;
  page_url: string | null;
  referrer: string | null;
  timestamp: string;
  user_agent: string | null;
  browser_language: string | null;
  screen_width: number | null;
  screen_height: number | null;
  timezone: string | null;
  cookie_enabled: number | null;
  do_not_track: string | null;
  consent_status: string;
  fingerprint_hash: string | null;
  fingerprint_confidence: number | null;
  tracking_method: string;
  request_type: string;
  event_name: string;
  relinked_by_fingerprint: number | null;
  event_type: "page_view" | "tracking_blocked" | "lead_submitted";
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  zip_code?: string | null;
  plan_interest?: string | null;
};

const dbPath = process.env.DB_PATH ?? "./data/tracker-demo.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT,
    site_name TEXT NOT NULL,
    page_url TEXT,
    referrer TEXT,
    timestamp TEXT NOT NULL,
    user_agent TEXT,
    browser_language TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    timezone TEXT,
    cookie_enabled INTEGER,
    do_not_track TEXT,
    consent_status TEXT NOT NULL,
    fingerprint_hash TEXT,
    fingerprint_confidence INTEGER,
    tracking_method TEXT NOT NULL DEFAULT 'JavaScript tracker',
    request_type TEXT NOT NULL DEFAULT 'POST fetch',
    event_name TEXT NOT NULL DEFAULT 'page_view',
    relinked_by_fingerprint INTEGER DEFAULT 0,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    zip_code TEXT,
    plan_interest TEXT,
    event_type TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_mappings (
    tracker_id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visitor_identities (
    fingerprint_hash TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const eventColumns = db.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
if (!eventColumns.some((column) => column.name === "relinked_by_fingerprint")) {
  db.exec("ALTER TABLE events ADD COLUMN relinked_by_fingerprint INTEGER DEFAULT 0");
}
if (!eventColumns.some((column) => column.name === "fingerprint_confidence")) {
  db.exec("ALTER TABLE events ADD COLUMN fingerprint_confidence INTEGER");
}
if (!eventColumns.some((column) => column.name === "tracking_method")) {
  db.exec("ALTER TABLE events ADD COLUMN tracking_method TEXT NOT NULL DEFAULT 'JavaScript tracker'");
}
if (!eventColumns.some((column) => column.name === "request_type")) {
  db.exec("ALTER TABLE events ADD COLUMN request_type TEXT NOT NULL DEFAULT 'POST fetch'");
}
if (!eventColumns.some((column) => column.name === "event_name")) {
  db.exec("ALTER TABLE events ADD COLUMN event_name TEXT NOT NULL DEFAULT 'page_view'");
}
for (const column of ["first_name", "last_name", "email", "phone", "zip_code", "plan_interest"]) {
  if (!eventColumns.some((eventColumn) => eventColumn.name === column)) {
    db.exec(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
  }
}

export function createVisitorId() {
  return `demo_tracker_${crypto.randomBytes(12).toString("hex")}`;
}

export function partnerIdForTrackerId(trackerId: string) {
  const digest = crypto.createHash("sha256").update(`partner-demo:${trackerId}`).digest("hex").slice(0, 16);
  return `partner_${digest}`;
}

export function findVisitorIdByFingerprint(fingerprintHash: string) {
  const mapped = db.prepare(`
    SELECT visitor_id
    FROM visitor_identities
    WHERE fingerprint_hash = ?
  `).get(fingerprintHash) as { visitor_id: string } | undefined;
  if (mapped?.visitor_id) return mapped.visitor_id;

  const row = db.prepare(`
    SELECT visitor_id
    FROM events
    WHERE fingerprint_hash = ?
      AND visitor_id IS NOT NULL
      AND event_type = 'page_view'
    ORDER BY id DESC
    LIMIT 1
  `).get(fingerprintHash) as { visitor_id: string } | undefined;
  return row?.visitor_id ?? null;
}

export function rememberFingerprintIdentity(fingerprintHash: string, visitorId: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO visitor_identities (fingerprint_hash, visitor_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(fingerprint_hash) DO UPDATE SET
      visitor_id = excluded.visitor_id,
      updated_at = excluded.updated_at
  `).run(fingerprintHash, visitorId, now, now);
}

export function insertEvent(event: TrackingEvent) {
  const inserted = db.prepare(`
    INSERT INTO events (
      visitor_id, site_name, page_url, referrer, timestamp, user_agent,
      browser_language, screen_width, screen_height, timezone, cookie_enabled,
      do_not_track, consent_status, fingerprint_hash, fingerprint_confidence,
      tracking_method, request_type, event_name, relinked_by_fingerprint,
      first_name, last_name, email, phone, zip_code, plan_interest, event_type
    )
    VALUES (
      @visitor_id, @site_name, @page_url, @referrer, @timestamp, @user_agent,
      @browser_language, @screen_width, @screen_height, @timezone, @cookie_enabled,
      @do_not_track, @consent_status, @fingerprint_hash, @fingerprint_confidence,
      @tracking_method, @request_type, @event_name, @relinked_by_fingerprint,
      @first_name, @last_name, @email, @phone, @zip_code, @plan_interest, @event_type
    )
  `).run({
    ...event,
    fingerprint_confidence: event.fingerprint_confidence ?? null,
    tracking_method: event.tracking_method ?? "JavaScript tracker",
    request_type: event.request_type ?? "POST fetch",
    event_name: event.event_name ?? event.event_type,
    relinked_by_fingerprint: event.relinked_by_fingerprint ?? 0,
    first_name: event.first_name ?? null,
    last_name: event.last_name ?? null,
    email: event.email ?? null,
    phone: event.phone ?? null,
    zip_code: event.zip_code ?? null,
    plan_interest: event.plan_interest ?? null
  });

  if (event.visitor_id && event.event_type === "page_view") {
    if (event.fingerprint_hash) rememberFingerprintIdentity(event.fingerprint_hash, event.visitor_id);

    db.prepare(`
      INSERT OR IGNORE INTO sync_mappings (tracker_id, partner_id, created_at)
      VALUES (?, ?, ?)
    `).run(event.visitor_id, partnerIdForTrackerId(event.visitor_id), new Date().toISOString());
  }

  return getEvent(Number(inserted.lastInsertRowid));
}

export function getEvent(id: number) {
  return db.prepare("SELECT * FROM events WHERE id = ?").get(id) as TrackingEvent | undefined;
}

export function getState() {
  const events = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 250").all();
  const mappings = db.prepare("SELECT * FROM sync_mappings ORDER BY created_at DESC").all();
  return { events, mappings };
}

export function clearData() {
  db.prepare("DELETE FROM events").run();
  db.prepare("DELETE FROM sync_mappings").run();
  db.prepare("DELETE FROM visitor_identities").run();
}
