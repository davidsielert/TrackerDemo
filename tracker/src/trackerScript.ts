export function trackerScript({ strictConsentMode }: { strictConsentMode: boolean }) {
  return `
(function () {
  "use strict";

  const CONFIG = {
    strictConsentMode: ${strictConsentMode},
    trackerOrigin: new URL(document.currentScript?.src || "http://tracker.localhost/tracker.js").origin,
    consentKey: "privacy_training_demo_consent",
    localVisitorKey: "privacy_training_demo_local_visitor_id"
  };

  const siteName = document.currentScript?.dataset.siteName || document.title || location.hostname;
  const trackingMode = document.currentScript?.dataset.trackingMode || "javascript";
  const autoPageView = document.currentScript?.dataset.autoPageView !== "false";
  const pixelRequests = [];

  loadRuntimeConfig().then(function (runtime) {
    if (runtime.cmpEnabled && !document.querySelector("[data-demo-tracker-banner]")) {
      renderConsentBanner();
    }
    const consent = getConsentStatus();
    if (autoPageView && isTrackingAllowed(runtime, consent)) {
      sendPageView(runtime);
    } else if (runtime.cmpEnabled && consent === "rejected") {
      sendBlockedEvent(runtime);
    }
  });

  window.demoTracker = {
    getConsentStatus: function () {
      return getConsentStatus();
    },
    sendLeadSubmitted: sendLeadSubmitted
  };

  function renderConsentBanner() {
    const banner = document.createElement("section");
    banner.dataset.demoTrackerBanner = "true";
    banner.innerHTML = \`
      <div class="demo-consent">
        <strong>Privacy training demo</strong>
        <span>This page can load a local-only fake third-party tracker from tracker.localhost. No real ad networks or analytics are used.</span>
        <button data-demo-accept>Accept tracking</button>
        <button data-demo-reject>Reject tracking</button>
        <button data-demo-reset>Reset choice</button>
      </div>
    \`;
    const style = document.createElement("style");
    style.textContent = \`
      .demo-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#111827;color:white;padding:14px 16px;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.28);font:14px/1.4 system-ui,sans-serif}
      .demo-consent span{flex:1;min-width:240px;color:#d1d5db}
      .demo-consent button{border:0;border-radius:6px;padding:8px 10px;font-weight:700;cursor:pointer}
      .demo-consent [data-demo-accept]{background:#22c55e;color:#052e16}
      .demo-consent [data-demo-reject]{background:#f97316;color:#431407}
      .demo-consent [data-demo-reset]{background:#e5e7eb;color:#111827}
    \`;
    document.head.appendChild(style);
    document.body.appendChild(banner);
    banner.querySelector("[data-demo-accept]").addEventListener("click", function () {
      localStorage.setItem(CONFIG.consentKey, "accepted");
      loadRuntimeConfig().then(function (runtime) {
        if (runtime.cmpEnabled && autoPageView) sendPageView(runtime);
      });
    });
    banner.querySelector("[data-demo-reject]").addEventListener("click", function () {
      localStorage.setItem(CONFIG.consentKey, "rejected");
      loadRuntimeConfig().then(function (runtime) {
        if (runtime.cmpEnabled) sendBlockedEvent(runtime);
      });
    });
    banner.querySelector("[data-demo-reset]").addEventListener("click", function () {
      localStorage.removeItem(CONFIG.consentKey);
      localStorage.removeItem(CONFIG.localVisitorKey);
      location.reload();
    });
  }

  function getConsentStatus() {
    return localStorage.getItem(CONFIG.consentKey) || "unknown";
  }

  async function loadRuntimeConfig() {
    try {
      const response = await fetch(CONFIG.trackerOrigin + "/api/config", { credentials: "include" });
      return await response.json();
    } catch (error) {
      console.warn("Demo tracker could not load CMP config", error);
      return { strictConsentMode: CONFIG.strictConsentMode, cmpEnabled: false };
    }
  }

  function isTrackingAllowed(runtime, consent) {
    if (!runtime.cmpEnabled) return true;
    return consent === "accepted";
  }

  async function getVisitorId(fingerprintHash) {
    try {
      const url = new URL(CONFIG.trackerOrigin + "/api/visitor-id");
      if (fingerprintHash) url.searchParams.set("fingerprint_hash", fingerprintHash);
      const response = await fetch(url.toString(), { credentials: "include" });
      const data = await response.json();
      if (data.visitor_id) {
        localStorage.setItem(CONFIG.localVisitorKey, data.visitor_id);
        return {
          visitorId: data.visitor_id,
          relinkedByFingerprint: Boolean(data.relinked_by_fingerprint)
        };
      }
    } catch (error) {
      console.warn("Demo tracker could not reach tracker.localhost", error);
    }
    let fallback = localStorage.getItem(CONFIG.localVisitorKey);
    if (!fallback) {
      fallback = "demo_local_" + cryptoRandom();
      localStorage.setItem(CONFIG.localVisitorKey, fallback);
    }
    return { visitorId: fallback, relinkedByFingerprint: false };
  }

  async function sendPageView(runtime) {
    const currentRuntime = runtime || await loadRuntimeConfig();
    const consent = currentRuntime.cmpEnabled ? getConsentStatus() : "unknown";
    if (!isTrackingAllowed(currentRuntime, consent)) return false;
    const fingerprint = await buildFingerprint();
    const identity = await getVisitorId(fingerprint.hash);
    postEvent({
      visitor_id: identity.visitorId,
      site_name: siteName,
      page_url: location.href,
      referrer: document.referrer || null,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      browser_language: navigator.language || null,
      screen_width: screen.width || null,
      screen_height: screen.height || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      cookie_enabled: navigator.cookieEnabled,
      do_not_track: navigator.doNotTrack || window.doNotTrack || null,
      consent_status: consent,
      fingerprint_hash: fingerprint.hash,
      fingerprint_confidence: fingerprint.confidence,
      tracking_method: trackingMethodLabel(),
      request_type: requestTypeLabel(),
      event_name: "page_view",
      relinked_by_fingerprint: identity.relinkedByFingerprint,
      event_type: "page_view"
    });
    return true;
  }

  async function sendBlockedEvent(runtime) {
    if (!runtime?.cmpEnabled) return false;
    postFetchEvent({
      visitor_id: null,
      site_name: siteName,
      page_url: null,
      referrer: null,
      timestamp: new Date().toISOString(),
      user_agent: null,
      browser_language: navigator.language || null,
      screen_width: null,
      screen_height: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      cookie_enabled: navigator.cookieEnabled,
      do_not_track: navigator.doNotTrack || window.doNotTrack || null,
      consent_status: "rejected",
      fingerprint_hash: null,
      fingerprint_confidence: null,
      tracking_method: "CMP gate audit",
      request_type: "POST fetch",
      event_name: "tracking_blocked",
      relinked_by_fingerprint: false,
      event_type: "tracking_blocked"
    });
    return true;
  }

  async function sendLeadSubmitted(fields) {
    const runtime = await loadRuntimeConfig();
    const currentConsent = runtime.cmpEnabled ? getConsentStatus() : "unknown";
    if (!isTrackingAllowed(runtime, currentConsent)) return false;

    postEvent({
      visitor_id: null,
      site_name: siteName,
      page_url: location.href,
      referrer: null,
      timestamp: new Date().toISOString(),
      user_agent: null,
      browser_language: null,
      screen_width: null,
      screen_height: null,
      timezone: null,
      cookie_enabled: null,
      do_not_track: null,
      consent_status: currentConsent,
      fingerprint_hash: null,
      fingerprint_confidence: null,
      tracking_method: "Local training lead event",
      request_type: "POST fetch",
      event_name: "LeadSubmitted",
      relinked_by_fingerprint: false,
      event_type: "lead_submitted",
      first_name: fields?.first_name ?? null,
      last_name: fields?.last_name ?? null,
      email: fields?.email ?? null,
      phone: fields?.phone ?? null,
      zip_code: fields?.zip_code ?? null,
      plan_interest: fields?.plan_interest ?? null
    });
    return true;
  }

  function postEvent(payload) {
    if (trackingMode === "pixel") {
      const pixelUrl = new URL(CONFIG.trackerOrigin + "/api/pixel");
      Object.entries(payload).forEach(function ([key, value]) {
        if (value !== null && value !== undefined) pixelUrl.searchParams.set(key, String(value));
      });
      const image = new Image(1, 1);
      image.alt = "";
      image.referrerPolicy = "no-referrer-when-downgrade";
      image.src = pixelUrl.toString();
      pixelRequests.push(image);
      return;
    }

    if (trackingMode === "beacon" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      if (navigator.sendBeacon(CONFIG.trackerOrigin + "/api/events", blob)) return;
    }

    fetch(CONFIG.trackerOrigin + "/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function (error) {
      console.warn("Demo tracking event failed", error);
    });
  }

  function postFetchEvent(payload) {
    fetch(CONFIG.trackerOrigin + "/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function (error) {
      console.warn("Demo tracking audit event failed", error);
    });
  }

  function trackingMethodLabel() {
    if (trackingMode === "pixel") return "Image pixel beacon";
    if (trackingMode === "beacon") return "sendBeacon API";
    return "JavaScript tracker";
  }

  function requestTypeLabel() {
    if (trackingMode === "pixel") return "GET image pixel";
    if (trackingMode === "beacon") return "POST sendBeacon";
    return "POST fetch";
  }

  async function buildFingerprint() {
    // Keep this training fingerprint intentionally boring and deterministic.
    // Canvas output can be randomized per top-level site by privacy features,
    // which would obscure the cross-context linkage concept this demo teaches.
    const signals = [
      "privacy-training-fingerprint-v2",
      navigator.userAgent,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen.width && screen.height ? screen.width + "x" + screen.height : "",
      navigator.platform,
      navigator.hardwareConcurrency,
      navigator.deviceMemory || ""
    ];
    const availableSignals = signals.filter(Boolean).length;
    return {
      hash: await sha256(signals.map(function (signal) { return signal || "unknown"; }).join("||")),
      confidence: Math.round((availableSignals / signals.length) * 100)
    };
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function cryptoRandom() {
    const values = new Uint8Array(12);
    crypto.getRandomValues(values);
    return Array.from(values).map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }
})();`;
}
