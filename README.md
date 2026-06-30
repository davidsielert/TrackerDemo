# Local Privacy Training Demo

This project is a local-only privacy training demo that shows how cross-context advertising tracking can work after consent, how tracking is blocked when consent is rejected, how simplified fingerprinting may appear to re-link visits, and how cookie syncing is commonly explained.

No real personal data is collected. No ad networks, analytics providers, or external tracker services are used. The demo runs on localhost only.

## Services

- `news.localhost`: fictional news site
- `weather.localhost`: fictional weather site
- `shop.localhost`: fictional retail site
- `lead-form.localhost`: fictional lead form for PII risk training
- `demo.localhost`: presenter-friendly guided demo hub
- `tracker.localhost`: local third-party tracker API and `tracker.js`
- `dashboard.localhost`: live training dashboard

## Requirements

- Node.js 20 or newer for the no-Docker local demo
- Docker and Docker Compose only if you want the containerized setup

Most systems resolve `*.localhost` to `127.0.0.1` automatically. If yours does not, add these entries to `/etc/hosts`:

```text
127.0.0.1 news.localhost
127.0.0.1 weather.localhost
127.0.0.1 shop.localhost
127.0.0.1 lead-form.localhost
127.0.0.1 demo.localhost
127.0.0.1 tracker.localhost
127.0.0.1 dashboard.localhost
```

## Setup Without Docker

Use this path when the demo computer cannot run Docker.

```bash
npm install
npm run dev:local
```

Then open:

- [http://dashboard.localhost:5173](http://dashboard.localhost:5173)
- [http://demo.localhost:8080](http://demo.localhost:8080)
- [http://news.localhost:8080](http://news.localhost:8080)
- [http://weather.localhost:8080](http://weather.localhost:8080)
- [http://shop.localhost:8080](http://shop.localhost:8080)
- [http://lead-form.localhost:8080](http://lead-form.localhost:8080)

The local Node setup uses these ports:

- tracker API and `tracker.js`: `tracker.localhost:4000`
- dashboard Vite app: `dashboard.localhost:5173`
- demo sites: `demo.localhost:8080`, `news.localhost:8080`, `weather.localhost:8080`, `shop.localhost:8080`, `lead-form.localhost:8080`

## Setup With Docker

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- [http://dashboard.localhost](http://dashboard.localhost)
- [http://demo.localhost](http://demo.localhost)
- [http://news.localhost](http://news.localhost)
- [http://weather.localhost](http://weather.localhost)
- [http://shop.localhost](http://shop.localhost)
- [http://lead-form.localhost](http://lead-form.localhost)

The Docker setup publishes the nginx proxy on host port `80` by default. Change `HOST_HTTP_PORT` in `.env` if you need a different port.

If your Docker runtime cannot bind privileged ports, set this in `.env` before starting the stack:

```bash
HOST_HTTP_PORT=8080
```

Then recreate the stack with `docker compose up -d --build --force-recreate` and open `http://dashboard.localhost:8080/`.

After code changes, rebuild and recreate the containers so Podman/Docker does not reuse old images:

```bash
docker compose up -d --build --force-recreate
```

## Demo Flow

For the no-Docker setup, use the same hostnames with the ports shown above.

1. Open the dashboard.
   You can also start from `demo.localhost` for a guided presentation flow.
2. Leave **CMP gate** disabled to show that the demo tracker is enabled by default.
3. Open the news, weather, and shop sites.
4. Return to the dashboard and show script, image pixel, and beacon events arriving without waiting for accepted consent.
5. Click **Enable CMP gate** on the dashboard.
6. Open a demo site, click **Reject tracking**, and show the blocked/no-consent event. The event intentionally omits behavioral fields such as page URL, visitor ID, and fingerprint hash.
7. On the demo site, click **Reset choice**, then click **Accept tracking**.
8. Visit the weather and shop sites, accepting tracking on each when prompted.
9. Return to the dashboard and show the same demo visitor ID appearing across news, weather, and shop contexts.
10. Clear browser cookies/localStorage for the local demo domains, including `tracker.localhost`.
11. Revisit a demo site and accept tracking again.
12. Return to the dashboard and show **ID reissued by fingerprint**. Cookies still carry the demo visitor ID when present, but if cookies are partitioned by top-level site or cleared entirely, the local backend can recognize the previously seen fingerprint hash and re-send the previous demo visitor ID.
13. Explain the **Cookie Sync Simulation** panel: the backend fabricates a `partner_id` for each accepted `tracker_id` and shows a local-only mapping between this demo tracker and a simulated partner namespace. No partner system exists.
14. Click **Clear demo data** in the dashboard, or run `./scripts/reset-demo.sh`.

## Mixed Tracking Method Demo

The demo sites intentionally use different local tracking methods:

- News: JavaScript tracker using a JSON `fetch` request
- Weather: image pixel beacon using a GET request for a 1x1 GIF
- Shop: shared JavaScript tracker using `navigator.sendBeacon`
- Lead Form: custom local training event with privacy-safe and risky PII modes

Scripted flow:

1. Accept tracking on all three demo sites.
2. Visit News and show the `JavaScript tracker` / `POST fetch` event.
3. Visit Weather and show the `Image pixel beacon` / `GET image pixel` event.
4. Visit Shop and show the `sendBeacon API` / `POST sendBeacon` event.
5. In the dashboard, open **Same Profile, Different Tracking Methods** and show all three grouped under one visitor profile.
6. Explain that cross-context tracking is about shared identity and profile linkage, not one specific tracking technology.

## PII Risk Demo

This is a local-only educational simulation. It does not use Meta, Facebook, real pixels, real ad networks, or external requests. The lead form uses fake example data only.

1. Open `lead-form.localhost`.
2. Submit the form in privacy-safe mode.
3. Show that the dashboard receives only a `LeadSubmitted` event with generic fields: `event_name`, `page_url`, `site_name`, `timestamp`, and `consent_status`.
4. Switch to risky PII mode.
5. Submit the fake form data.
6. Show that the dashboard flags name, email, phone, and ZIP as PII in the **PII Risk Demo** panel.
7. Explain that this is why tag governance, data layer review, and consent enforcement matter.

The dashboard includes a **Show events containing PII** filter and scores PII risk as:

- Low: no PII sent
- Medium: pseudonymous ID only
- High: email, phone, or name sent

## Consent Behavior

The dashboard has a **CMP gate** button that controls whether the local fake tracker waits for accepted consent.

- When **CMP gate** is disabled, demo tracking remains enabled by default. JavaScript, beacon, image pixel, and lead-form training events can fire even when the banner has not been accepted.
- When **CMP gate** is enabled, JavaScript, beacon, image pixel, and lead-form training events wait for **Accept tracking**.
- With **CMP gate** enabled, **Reject tracking** sends only a minimal `tracking_blocked` event so trainers can show that tracking was blocked due to no consent.
- **Reset choice** clears the demo consent and local demo visitor ID for that site.

Set `CMP_ENABLED=true` in `.env` if you want the tracker to start in CMP-gated mode.

## Event Fields

Accepted tracking events include:

- `visitor_id`
- `site_name`
- `page_url`
- `referrer`
- `timestamp`
- `user_agent`
- `browser_language`
- `screen_width`
- `screen_height`
- `timezone`
- `cookie_enabled`
- `do_not_track`
- `consent_status`
- `fingerprint_hash`
- `fingerprint_confidence`
- `tracking_method`
- `request_type`
- `event_name`

The fingerprint hash is created client-side from a simplified set of browser traits:

- user agent
- language
- timezone
- screen size
- platform
- hardware concurrency
- device memory when available
- canvas sample

This is intentionally simplified, probabilistic, and for education only.

The tracker still writes demo cookies when cookies are available, including a SameSite=None third-party cookie variant for browsers/environments that allow it. The fingerprint demo is a fallback reassociation example: if the browser partitions or blocks tracker cookies by top-level site, or after cookies and localStorage are cleared, the training tracker sends the browser fingerprint hash to `/api/visitor-id`. If that hash matches a previous event, the backend reissues the earlier demo `visitor_id`, writes that canonical ID back as the tracker cookie, and labels the event as fingerprint re-linked. This behavior is deliberately prominent so the demo can show why fingerprinting raises privacy concerns; it should not be treated as reliable identity or production guidance.

The dashboard also shows a fingerprint confidence level. This is a demo-only heuristic based on how many fingerprint ingredients were available in the browser. It is not a statistical identity guarantee.

## Persistence and Reset

Events and simulated sync mappings are stored in SQLite at `/data/tracker-demo.sqlite` inside the `tracker` container. Docker stores this in the `tracker-data` volume.

Clear demo data while the local Node setup is running:

```bash
./scripts/reset-demo.sh
```

In Docker mode, the same script falls back to `docker compose exec tracker npm run reset`.

Or remove all containers and the SQLite volume:

```bash
docker compose down -v
```

## Development

Tracker service:

```bash
cd tracker
npm install
npm run dev
```

Dashboard:

```bash
cd dashboard
npm install
npm run dev
```

Run the tracker tests:

```bash
cd tracker
npm install
npm test
```

Run the browser regression tests against the Docker demo:

```bash
docker compose up -d --build --force-recreate
npm install
npx playwright install chromium
npm run test:e2e
```

If you publish the Docker proxy on a non-default port, pass it to the tests:

```bash
DEMO_PORT=8080 npm run test:e2e
```

Update and rerun the Playwright tests whenever changing tracker identity, consent gating, request transport, or dashboard profile-linkage behavior.

## Training Notes

Use this demo to discuss consent, third-party contexts, browser storage, cross-site identifiers, fingerprinting limits, and cookie-sync concepts. In the cookie-sync panel, the tracker ID is the local tracker cookie value and the partner ID is a fabricated pseudonymous ID derived from it to demonstrate how one system can map its identifier to another system's namespace. Do not present the fingerprint hash or partner ID as real identity resolution; both are local-only training artifacts.
