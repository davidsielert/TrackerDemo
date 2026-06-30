import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Ban, Database, Fingerprint, RotateCcw, ShieldCheck } from "lucide-react";
import "./styles.css";

type EventRow = {
  id: number;
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
  consent_status: "unknown" | "accepted" | "rejected";
  fingerprint_hash: string | null;
  fingerprint_confidence: number | null;
  tracking_method: string;
  request_type: string;
  event_name: string;
  relinked_by_fingerprint: number | null;
  event_type: "page_view" | "tracking_blocked" | "lead_submitted";
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  zip_code: string | null;
  plan_interest: string | null;
};

type Mapping = { tracker_id: string; partner_id: string; created_at: string };
type State = { events: EventRow[]; mappings: Mapping[] };
type Config = { strictConsentMode: boolean; cmpEnabled: boolean };

const apiOrigin = trackerOrigin();

function trackerOrigin() {
  if (window.location.port === "5173") return "http://tracker.localhost:4000";
  return `http://tracker.localhost${window.location.port ? `:${window.location.port}` : ""}`;
}

function App() {
  const [state, setState] = useState<State>({ events: [], mappings: [] });
  const [config, setConfig] = useState<Config>({ strictConsentMode: true, cmpEnabled: false });
  const [selectedVisitor, setSelectedVisitor] = useState<string>("all");
  const [showOnlyPii, setShowOnlyPii] = useState(false);

  useEffect(() => {
    fetch(`${apiOrigin}/api/state`).then((res) => res.json()).then(setState);
    fetch(`${apiOrigin}/api/config`).then((res) => res.json()).then(setConfig);
    const stream = new EventSource(`${apiOrigin}/api/events/stream`);
    const handler = (message: MessageEvent) => {
      const payload = JSON.parse(message.data);
      setState(payload.state ?? payload);
      if (payload.config) setConfig(payload.config);
    };
    stream.addEventListener("state", handler);
    stream.addEventListener("update", handler);
    return () => stream.close();
  }, []);

  const visitors = useMemo(() => {
    return Array.from(new Set(state.events.map((event) => event.visitor_id).filter(Boolean) as string[]));
  }, [state.events]);

  const filteredEvents = state.events.filter((event) => {
    const matchesVisitor = selectedVisitor === "all" || event.visitor_id === selectedVisitor;
    const matchesPii = !showOnlyPii || containsPii(event);
    return matchesVisitor && matchesPii;
  });

  const activeVisitor = selectedVisitor === "all" ? visitors[0] : selectedVisitor;
  const profileEvents = activeVisitor ? state.events.filter((event) => event.visitor_id === activeVisitor) : [];
  const blockedCount = state.events.filter((event) => event.event_type === "tracking_blocked").length;
  const relinkedCount = state.events.filter((event) => event.relinked_by_fingerprint).length;
  const fingerprintGroups = groupByFingerprint(state.events);
  const methodProfiles = groupProfilesByVisitor(state.events);
  const piiEvents = state.events.filter((event) => event.event_type === "lead_submitted");

  async function clearDemoData() {
    await fetch(`${apiOrigin}/api/events`, { method: "DELETE" });
    setState({ events: [], mappings: [] });
    setSelectedVisitor("all");
  }

  async function toggleCmp() {
    const response = await fetch(`${apiOrigin}/api/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmpEnabled: !config.cmpEnabled })
    });
    setConfig(await response.json());
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Local-only privacy compliance training</p>
          <h1>Cross-Context Tracking Demo</h1>
          <p className="subtle">Everything here runs on localhost. It uses fake content, demo identifiers, and no real ad networks, analytics tools, or external tracking services.</p>
        </div>
        <div className="topActions">
          <button className={config.cmpEnabled ? "cmpButton enabled" : "cmpButton"} onClick={toggleCmp}>
            <ShieldCheck size={18} /> {config.cmpEnabled ? "Disable CMP gate" : "Enable CMP gate"}
          </button>
          <button className="danger" onClick={clearDemoData}><RotateCcw size={18} /> Clear demo data</button>
        </div>
      </header>

      <section className={config.cmpEnabled ? "notice" : "notice permissive"}>
        <ShieldCheck size={20} />
        <span>{config.cmpEnabled
          ? "CMP gate enabled: script, beacon, image pixel, and lead events wait for accepted consent. Rejected consent blocks tracking payloads."
          : "CMP gate disabled: demo tracking remains enabled by default, so script, beacon, image pixel, and lead events can fire without waiting for consent."}</span>
      </section>

      <section className="metrics">
        <Metric icon={<Database />} label="Events" value={state.events.length} />
        <Metric icon={<Ban />} label="Blocked" value={blockedCount} />
        <Metric icon={<Fingerprint />} label="ID reissued by fingerprint" value={relinkedCount} />
      </section>

      <section className="layout">
        <div className="panel wide">
          <div className="panelHead">
            <h2>Live Event Stream</h2>
            <div className="filters">
              <label className="checkFilter">
                <input type="checkbox" checked={showOnlyPii} onChange={(event) => setShowOnlyPii(event.target.checked)} />
                Show events containing PII
              </label>
              <select value={selectedVisitor} onChange={(event) => setSelectedVisitor(event.target.value)}>
                <option value="all">All visitor IDs</option>
                {visitors.map((visitor) => <option key={visitor} value={visitor}>{short(visitor)}</option>)}
              </select>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>Tracking method</th>
                <th>Request type</th>
                <th>Visitor ID</th>
                <th>Fingerprint hash</th>
                <th>Event name</th>
                <th>Consent status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr key={event.id} className={event.event_type === "tracking_blocked" ? "blocked" : ""}>
                  <td>{event.site_name}</td>
                  <td>{event.tracking_method}</td>
                  <td>{event.request_type}</td>
                  <td>{event.visitor_id ? short(event.visitor_id) : "none"}</td>
                  <td>{event.fingerprint_hash ? short(event.fingerprint_hash) : "not collected"}</td>
                  <td>{event.event_name}</td>
                  <td>{event.event_type === "tracking_blocked" ? "Blocked: no consent" : statusLabel(event)}</td>
                </tr>
              ))}
              {filteredEvents.length === 0 && <tr><td colSpan={7}>No events yet. Visit a demo site to begin.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2><AlertTriangle size={18} /> PII Risk Demo</h2>
          <p className="subtle">Pixels and tags can receive form data when developers intentionally or accidentally include it in event payloads, URL parameters, data layer variables, or automatic advanced matching configurations.</p>
          {piiEvents.map((event) => {
            const fields = capturedLeadFields(event);
            const risk = piiRiskScore(event);
            return (
              <div className={`piiEvent risk${risk}`} key={event.id}>
                <div className="piiEventHead">
                  <b>Event #{event.id}: {event.event_name}</b>
                  <span>{risk} risk</span>
                </div>
                <dl className="fieldList">
                  {fields.map((field) => (
                    <React.Fragment key={field.name}>
                      <dt className={field.isPii ? "piiField" : ""}>{field.label}{field.isPii ? " PII" : ""}</dt>
                      <dd>{field.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            );
          })}
          {piiEvents.length === 0 && <p className="subtle">LeadSubmitted events will appear here after you submit the fake lead form.</p>}
        </div>

        <div className="panel">
          <h2>Visitor Profile</h2>
          {activeVisitor ? (
            <>
              <dl>
                <dt>Visitor ID</dt><dd>{activeVisitor}</dd>
                <dt>Sites visited</dt><dd>{new Set(profileEvents.map((event) => event.site_name)).size}</dd>
                <dt>Consent status</dt><dd>{profileEvents[0]?.consent_status ?? "unknown"}</dd>
                <dt>Fingerprint hash</dt><dd>{profileEvents.find((event) => event.fingerprint_hash)?.fingerprint_hash ?? "none"}</dd>
                <dt>Confidence</dt><dd>{confidenceText(profileEvents.find((event) => event.fingerprint_confidence !== null)?.fingerprint_confidence ?? null)}</dd>
              </dl>
              <h3>Timeline</h3>
              <ol className="timeline">
                {profileEvents.slice().reverse().map((event) => (
                  <li key={event.id}><strong>{event.site_name}</strong><span>{event.page_url ?? "blocked event only"}</span></li>
                ))}
              </ol>
            </>
          ) : <p className="subtle">Accepted tracking events will create a visitor profile here.</p>}
        </div>

        <div className="panel">
          <h2>Same Profile, Different Tracking Methods</h2>
          <p className="subtle">Different request styles can still feed one backend profile. The tracker issues demo cookies, including a third-party cookie variant where the browser allows it. If the browser partitions or blocks those cookies by top-level site, this demo uses the matching fingerprint as a fallback to canonicalize site-specific IDs back to one demo visitor ID.</p>
          {methodProfiles.map((profile) => (
            <div className="profileMethods" key={profile.visitorId}>
              <b>{short(profile.visitorId)}</b>
              <MethodLine site="News" expected="JavaScript tracker" actual={profile.methods["news.localhost"]} />
              <MethodLine site="Weather" expected="Image pixel beacon" actual={profile.methods["weather.localhost"]} />
              <MethodLine site="Shop" expected="sendBeacon API" actual={profile.methods["shop.localhost"]} />
            </div>
          ))}
          {methodProfiles.length === 0 && <p className="subtle">Accept tracking on News, Weather, and Shop to see one visitor profile receive events from multiple methods.</p>}
        </div>

        <div className="panel">
          <h2>Fingerprint Demo</h2>
          <p className="subtle">Cookies, including third-party cookies where accepted by the browser, still carry the demo visitor ID when they exist. Fingerprinting is shown as a fallback: it can reconnect partitioned site-specific cookies, and after you clear cookies/localStorage, the same browser fingerprint can cause the previous demo visitor ID to be reissued. This is probabilistic training behavior and can be wrong.</p>
          {fingerprintGroups.map((group) => (
            <div className={group.relinkedCount > 0 || group.visitorIds.size > 1 ? "matchCard alert" : "matchCard"} key={group.hash}>
              <b>{short(group.hash)}</b>
              <span>{group.count} event(s), {group.visitorIds.size} visitor ID(s), {group.relinkedCount} ID reissue(s)</span>
              <ConfidenceBar value={group.averageConfidence} />
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Cookie Sync Simulation</h2>
          <p className="subtle">Each accepted page view creates a fabricated partner mapping. The tracker ID represents this demo tracker cookie, while the partner ID represents how a separate ad partner might store its own pseudonymous ID after a sync. This is a one-way local hash for training only; no partner or ad system exists.</p>
          {state.mappings.map((mapping) => (
            <div className="mapping" key={mapping.tracker_id}>
              <span><b>Tracker ID</b>{short(mapping.tracker_id)}</span>
              <strong>→</strong>
              <span><b>Partner ID</b>{mapping.partner_id}</span>
            </div>
          ))}
          {state.mappings.length === 0 && <p className="subtle">Mappings appear after accepted tracking events.</p>}
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="metric">{icon}<span>{label}</span><strong>{value}</strong></div>;
}

function MethodLine({ site, expected, actual }: { site: string; expected: string; actual?: string }) {
  return (
    <div className={actual ? "methodLine seen" : "methodLine"}>
      <span>{site}: {expected}</span>
      <strong>{actual ? "seen" : "waiting"}</strong>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null) return <span className="confidence empty">Confidence unavailable</span>;
  return (
    <div className="confidence" aria-label={`Fingerprint confidence ${value}%`}>
      <span>{confidenceText(value)}</span>
      <div><i style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function confidenceText(value: number | null) {
  if (value === null) return "none";
  const label = value >= 85 ? "high" : value >= 60 ? "medium" : "low";
  return `${value}% ${label}`;
}

function statusLabel(event: EventRow) {
  return event.relinked_by_fingerprint ? "accepted, fingerprint re-link" : event.consent_status;
}

const piiFieldNames = ["first_name", "last_name", "email", "phone", "zip_code"] as const;
const leadFieldLabels: Record<keyof Pick<EventRow, "first_name" | "last_name" | "email" | "phone" | "zip_code" | "plan_interest">, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  zip_code: "ZIP code",
  plan_interest: "Plan interest"
};

function containsPii(event: EventRow) {
  return piiFieldNames.some((field) => Boolean(event[field]));
}

function piiRiskScore(event: EventRow): "Low" | "Medium" | "High" {
  if (event.first_name || event.last_name || event.email || event.phone) return "High";
  if (event.visitor_id || event.fingerprint_hash) return "Medium";
  return "Low";
}

function capturedLeadFields(event: EventRow) {
  const fieldNames = Object.keys(leadFieldLabels) as Array<keyof typeof leadFieldLabels>;
  const fields = fieldNames.map((name) => ({
    name,
    label: leadFieldLabels[name],
    value: event[name] || "not sent",
    isPii: piiFieldNames.includes(name as typeof piiFieldNames[number])
  }));
  return [
    { name: "event_name", label: "Event name", value: event.event_name, isPii: false },
    { name: "page_url", label: "Page URL", value: event.page_url ?? "not sent", isPii: false },
    { name: "site_name", label: "Site name", value: event.site_name, isPii: false },
    { name: "timestamp", label: "Timestamp", value: event.timestamp, isPii: false },
    { name: "consent_status", label: "Consent status", value: event.consent_status, isPii: false },
    ...fields
  ];
}

function groupByFingerprint(events: EventRow[]) {
  const map = new Map<string, { hash: string; count: number; confidenceTotal: number; confidenceCount: number; averageConfidence: number | null; relinkedCount: number; visitorIds: Set<string> }>();
  for (const event of events) {
    if (!event.fingerprint_hash) continue;
    const group = map.get(event.fingerprint_hash) ?? {
      hash: event.fingerprint_hash,
      count: 0,
      confidenceTotal: 0,
      confidenceCount: 0,
      averageConfidence: null,
      relinkedCount: 0,
      visitorIds: new Set<string>()
    };
    group.count += 1;
    if (event.fingerprint_confidence !== null) {
      group.confidenceTotal += event.fingerprint_confidence;
      group.confidenceCount += 1;
      group.averageConfidence = Math.round(group.confidenceTotal / group.confidenceCount);
    }
    if (event.relinked_by_fingerprint) group.relinkedCount += 1;
    if (event.visitor_id) group.visitorIds.add(event.visitor_id);
    map.set(event.fingerprint_hash, group);
  }
  return Array.from(map.values());
}

function groupProfilesByVisitor(events: EventRow[]) {
  const profiles = new Map<string, { visitorId: string; methods: Record<string, string> }>();
  for (const event of events) {
    if (!event.visitor_id || event.event_type !== "page_view") continue;
    const profile = profiles.get(event.visitor_id) ?? { visitorId: event.visitor_id, methods: {} };
    profile.methods[event.site_name] = event.tracking_method;
    profiles.set(event.visitor_id, profile);
  }
  return Array.from(profiles.values()).filter((profile) => Object.keys(profile.methods).length > 0);
}

createRoot(document.getElementById("root")!).render(<App />);
