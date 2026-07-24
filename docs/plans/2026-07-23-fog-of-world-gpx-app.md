# Fog of World GPX App Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Build a local-first Traditional Chinese web app that converts confirmed flights and Google Timeline exports into provenance-rich GPX 1.1 files whose adjacent points never exceed 2 km.

**Architecture:** Use a Next.js App Router application as a local browser UI plus same-origin API proxy so provider keys never reach the client. Parse Timeline JSON in a Web Worker, retain only semantic route data, cache repaired routes and user corrections in IndexedDB, and generate/validate GPX in the browser. Every route carries its kind, source, reference date, approximation state, and user-override metadata.

**Tech Stack:** Node.js 24, npm, Next.js App Router, React, TypeScript, Tailwind CSS, Zod, `@streamparser/json`, `idb`, `@mapbox/polyline`, Vitest, React Testing Library, Playwright, `fast-xml-parser`.

**Implementation discipline:** Follow @Test-Driven Development (TDD) for every behavior and @Verification Before Completion before each commit or completion claim. Do not commit the user's real Timeline file or coordinates.

---

## Product contracts to preserve

- Home buttons are labeled `航班` and `時間軸`.
- Flight search uses AeroDataBox. OpenSky is only an optional recent-track enhancement.
- Flight route fallback order is actual OpenSky track, AeroDataBox filed plan, Flight Plan Database simulated plan, then a densified direct airport-to-airport line.
- OpenSky REST tracks are attempted only for completed flights no more than 30 days old, after identifying the aircraft from callsign, time window, and exact origin/destination; a supplied ICAO24 is only a candidate preference.
- Flights 31–100 days old keep exact flight metadata when available but use an approximate route.
- Flights more than 100 days old use the most recent route with the same flight number and identical origin/destination; the UI and GPX must show the reference date.
- Flight route labels are exactly `實際軌跡`, `申報航路`, `模擬航路`, and `直接連線`, with a separate data-source label.
- Timeline input is parsed locally. Raw JSON, Wi-Fi scans, and user-location profile data must never be sent to the server.
- Recorded Timeline points win. Route providers only repair missing/sparse legs.
- Explicit and probable flights split GPX track segments and appear in the final report.
- Ground routing uses OpenRouteService; public transport uses Transitous current network data and is labeled as an approximation.
- When every route source fails, do not draw a straight line. Queue the segment for user review.
- Review actions are `重新查詢`, `此路段不存在`, and `暫時略過`.
- The final report distinguishes automatic success, user-corrected success, user-excluded non-existent segments, skipped flights, and still-unresolved segments.
- A partially successful GPX is downloadable with a warning. A result with zero valid track segments is not downloadable.
- Within every emitted `<trkseg>`, every adjacent point pair must be at most 2,000 meters apart.

## Public interfaces and core types

Use these wire contracts consistently:

```ts
type RouteKind =
  | 'recorded-timeline'
  | 'actual-track'
  | 'filed-plan'
  | 'simulated-plan'
  | 'direct-line'
  | 'ground-route'
  | 'transit-route';

type RouteSource =
  | 'google-timeline'
  | 'opensky'
  | 'aerodatabox'
  | 'flight-plan-database'
  | 'openrouteservice'
  | 'transitous'
  | 'local-calculation'
  | 'user';

type TransportMode =
  | 'walking'
  | 'running'
  | 'cycling'
  | 'motorcycling'
  | 'driving'
  | 'train'
  | 'subway'
  | 'bus'
  | 'tram'
  | 'ferry'
  | 'flying'
  | 'unknown';

interface RouteProvenance {
  kind: RouteKind;
  source: RouteSource;
  referenceDate: string | null; // YYYY-MM-DD
  approximate: boolean;
  explanation: string;
  originalMode?: TransportMode;
  correctedMode?: TransportMode;
  userOverride?: boolean;
}

interface GeoPoint {
  lat: number;
  lon: number;
  time?: string; // RFC3339 UTC when emitted to GPX
  elevationMeters?: number;
}

interface RouteSegment {
  id: string;
  name: string;
  mode: TransportMode;
  points: GeoPoint[];
  provenance: RouteProvenance;
}
```

HTTP endpoints:

```text
GET  /api/config/status
POST /api/flights/search
POST /api/airports/search
POST /api/flights/resolve-route
POST /api/routes/repair
POST /api/geocode/reverse
```

Every POST route validates JSON with Zod, returns `{ data }` on success, and returns `{ error: { code, message, retryable } }` on failure. Never return provider keys, raw provider payloads, or coordinate-containing server logs.

---

### Task 1: Scaffold the application and test harness

**Files:**
- Create/replace: `package.json`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `playwright.config.ts`
- Create: `tsconfig.json`
- Create: `.env.example`
- Modify: `.gitignore`

**Step 1: Scaffold Next.js**

Run from the worktree:

```powershell
npx.cmd create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

Expected: Next.js creates an App Router project without changing the current branch.

**Step 2: Install runtime and test dependencies**

```powershell
npm.cmd install zod idb @streamparser/json @mapbox/polyline fast-xml-parser
npm.cmd install --save-dev vitest @vitejs/plugin-react vite-tsconfig-paths jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test fake-indexeddb @types/mapbox__polyline
```

Expected: dependencies are recorded in `package.json` and `package-lock.json`.

**Step 3: Add scripts and test configuration**

Add:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Configure Vitest for `jsdom`, `@/` aliases, globals, and `src/test/setup.ts`. Configure Playwright to start `npm.cmd run dev` on `http://127.0.0.1:3000`.

**Step 4: Add environment placeholders**

`.env.example` must contain names only:

```dotenv
AERODATABOX_RAPIDAPI_KEY=
OPENROUTESERVICE_API_KEY=
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
FLIGHTPLANDB_API_KEY=
TRANSITOUS_CONTACT_URL=https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY
```

Ensure `.env.local`, Playwright artifacts, and local test outputs are ignored.

**Step 5: Verify baseline**

Run:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all commands exit 0.

**Step 6: Commit**

```powershell
git add package.json package-lock.json src vitest.config.ts playwright.config.ts tsconfig.json .env.example .gitignore
git commit -m "chore: scaffold local Next.js application"
```

---

### Task 2: Define domain types and provenance labels

**Files:**
- Create: `src/lib/domain/types.ts`
- Create: `src/lib/domain/provenance.ts`
- Test: `src/lib/domain/provenance.test.ts`

**Step 1: Write failing label tests**

Test the exact Traditional Chinese flight labels and source labels:

```ts
expect(routeKindLabel('actual-track')).toBe('實際軌跡');
expect(routeKindLabel('filed-plan')).toBe('申報航路');
expect(routeKindLabel('simulated-plan')).toBe('模擬航路');
expect(routeKindLabel('direct-line')).toBe('直接連線');
expect(routeSourceLabel('opensky')).toBe('OpenSky');
```

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/domain/provenance.test.ts
```

Expected: FAIL because the module does not exist.

**Step 3: Implement the types and exhaustive label maps**

Add the public types above plus `FlightCandidate`, `ConfirmedFlight`, `TimelineActivity`, `RepairAttempt`, and `ProcessingReport`. Use `satisfies Record<...>` so missing labels fail type checking.

**Step 4: Run GREEN**

```powershell
npm.cmd test -- src/lib/domain/provenance.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/domain
git commit -m "feat: add route provenance domain model"
```

---

### Task 3: Implement geospatial distance, interpolation, and densification

**Files:**
- Create: `src/lib/geo/distance.ts`
- Create: `src/lib/geo/densify.ts`
- Create: `src/lib/geo/polyline.ts`
- Test: `src/lib/geo/distance.test.ts`
- Test: `src/lib/geo/densify.test.ts`

**Step 1: Write failing tests**

Cover:

- identical points return 0;
- known Taipei points are within an accepted tolerance;
- antimeridian interpolation takes the short path;
- a 5 km pair becomes at least four points;
- all output pairs are `<= 2_000 + 0.5` meters;
- inserted times and elevations interpolate between neighboring points;
- existing actual-track timestamps are retained.

Desired API:

```ts
distanceMeters(a, b): number
densifyPoints(points, { maxDistanceMeters: 2000 }): GeoPoint[]
interpolateRouteTimes(points, startIso, endIso): GeoPoint[]
decodePolyline(encoded, precision): GeoPoint[]
```

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/geo
```

Expected: FAIL because the functions do not exist.

**Step 3: Implement minimal spherical calculations**

Use haversine distance and spherical linear interpolation. Normalize longitude to `[-180, 180]`; never linearly interpolate raw longitude across the antimeridian. Allocate approximate-route timestamps by cumulative route distance.

**Step 4: Run GREEN and refactor**

```powershell
npm.cmd test -- src/lib/geo
npm.cmd run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/geo
git commit -m "feat: add safe route densification"
```

---

### Task 4: Build and validate provenance-rich GPX 1.1

**Files:**
- Create: `src/lib/gpx/build-gpx.ts`
- Create: `src/lib/gpx/validate-gpx.ts`
- Create: `src/lib/gpx/download.ts`
- Test: `src/lib/gpx/build-gpx.test.ts`
- Test: `src/lib/gpx/validate-gpx.test.ts`

**Step 1: Write failing GPX tests**

Assert:

- root namespace is `http://www.topografix.com/GPX/1/1`;
- extension namespace is `urn:fog-of-world-tool:extensions:v1`;
- XML special characters are escaped;
- each route is a separate `<trkseg>`;
- route/source/reference date/approximation/user override appear in `<extensions>`;
- unresolved count appears in metadata;
- invalid coordinates, invalid time, empty output, and a pair over 2 km fail validation;
- gaps between separate `<trkseg>` elements are not distance-checked;
- filenames are exactly `FlightRouteYYMMDD.gpx` and `TimelineRouteYYMMDD.gpx`.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/gpx
```

Expected: FAIL because the GPX modules do not exist.

**Step 3: Implement GPX writer**

Use a small explicit XML builder with one escape helper. Emit:

```xml
<gpx version="1.1"
  creator="Fog of World GPX Tool"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:fowt="urn:fog-of-world-tool:extensions:v1">
```

Store human-readable source summaries in `<desc>` and structured provenance in `fowt:*` extension fields. Omit `<ele>` when altitude is unknown. Emit all times in UTC.

**Step 4: Implement validation**

Parse with `fast-xml-parser`, verify GPX shape, coordinates, time values, non-empty track segments, and the 2 km invariant using the real geo helper.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/gpx
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/gpx
git commit -m "feat: generate and validate GPX files"
```

---

### Task 5: Create the application shell and source badges

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`
- Create: `src/app/data-sources/page.tsx`
- Create: `src/components/app-header.tsx`
- Create: `src/components/home-choice-card.tsx`
- Create: `src/components/source-badge.tsx`
- Create: `src/components/progress-panel.tsx`
- Create: `src/components/download-card.tsx`
- Test: `src/app/page.test.tsx`
- Test: `src/components/source-badge.test.tsx`

**Step 1: Write failing UI tests**

Assert the home page exposes two large links named `航班` and `時間軸`, never `Flight` or `Timeline`, and that badges show text as well as visual styling.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/app/page.test.tsx src/components/source-badge.test.tsx
```

Expected: FAIL against the scaffolded page.

**Step 3: Implement the shell**

Build a keyboard-accessible responsive layout. Link cards to `/flight` and `/timeline`; include a visible `資料來源` link in the shared header/footer. Do not add a map or analytics.

**Step 4: Run GREEN**

```powershell
npm.cmd test -- src/app/page.test.tsx src/components/source-badge.test.tsx
npm.cmd run lint
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/app src/components
git commit -m "feat: add Traditional Chinese application shell"
```

---

### Task 6: Add configuration checks, provider errors, and retry behavior

**Files:**
- Create: `src/lib/server/env.ts`
- Create: `src/lib/server/provider-error.ts`
- Create: `src/lib/server/fetch-with-retry.ts`
- Create: `src/app/api/config/status/route.ts`
- Test: `src/lib/server/fetch-with-retry.test.ts`
- Test: `src/app/api/config/status/route.test.ts`

**Step 1: Write failing retry tests**

Use injected `fetch` and `sleep` functions to prove:

- network and 5xx errors retry at most three times;
- `Retry-After` is honored for 429;
- 400/401/403 are not retried;
- provider errors are classified as `no_data`, `rate_limited`, `auth`, `quota`, `network`, or `provider_unavailable`;
- error serialization contains no request body or coordinate values.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/server src/app/api/config/status
```

Expected: FAIL because the helpers do not exist.

**Step 3: Implement server-only configuration**

Validate environment variables with Zod, but make provider keys optional so the app can start with reduced capabilities. `GET /api/config/status` returns booleans and setup messages, never key values.

**Step 4: Implement retry**

Prefer provider `Retry-After`; otherwise use short exponential backoff. Inject timing in tests. Never `console.log` request bodies.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/server src/app/api/config/status
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/server src/app/api/config
git commit -m "feat: add safe provider configuration and retries"
```

---

### Task 7: Implement AeroDataBox flight and airport lookup

**Files:**
- Create: `src/lib/providers/aerodatabox/client.ts`
- Create: `src/lib/providers/aerodatabox/schemas.ts`
- Create: `src/lib/providers/aerodatabox/map-flight.ts`
- Create: `src/app/api/flights/search/route.ts`
- Create: `src/app/api/airports/search/route.ts`
- Test: `src/lib/providers/aerodatabox/client.test.ts`
- Test: `src/app/api/flights/search/route.test.ts`

**Step 1: Write failing mapping tests**

Fixture responses must cover one flight, multiple legs/codeshares, an overnight arrival, canceled flights, and missing actual times. Assert:

- flight number is normalized to uppercase without spaces;
- candidates are filtered by departure-local date;
- airport city/name/IATA/ICAO/coordinates survive mapping;
- scheduled and actual times remain distinct;
- duration uses actual times when both exist, otherwise scheduled times;
- display times retain airport-local offsets while GPX times can convert to UTC.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/providers/aerodatabox src/app/api/flights/search
```

Expected: FAIL.

**Step 3: Implement the provider**

Call the AeroDataBox specific-date flight endpoint with `dateLocalRole=Departure`. Validate provider JSON before mapping. Return a `no_data` error for an empty candidate array. Implement airport autocomplete/lookup for manual fallback by IATA/ICAO/name.

**Step 4: Implement API validation**

Accept:

```ts
{ flightNumber: string; departureDate: 'YYYY-MM-DD' }
```

Reject malformed dates and flight identifiers before provider calls.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/providers/aerodatabox src/app/api/flights/search src/app/api/airports/search
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/providers/aerodatabox src/app/api/flights src/app/api/airports
git commit -m "feat: search and normalize flight information"
```

---

### Task 8: Implement the flight route cascade

**Files:**
- Create: `src/lib/providers/opensky/client.ts`
- Create: `src/lib/providers/flightplandb/client.ts`
- Create: `src/lib/flight/route-policy.ts`
- Create: `src/lib/flight/resolve-flight-route.ts`
- Create: `src/app/api/flights/resolve-route/route.ts`
- Test: `src/lib/flight/route-policy.test.ts`
- Test: `src/lib/flight/resolve-flight-route.test.ts`

**Step 1: Write failing age-policy tests**

Freeze time and assert:

- completed flight age `<= 30` days may try OpenSky;
- age 31–100 days skips OpenSky but keeps the exact flight metadata/reference date;
- age `> 100` days requests a representative same-number route and rejects candidates whose origin or destination differs;
- future flights never try OpenSky;
- boundary days 30, 31, 100, and 101 behave exactly.

**Step 2: Write failing cascade tests**

Inject provider functions and prove this order:

```text
OpenSky actual track
→ AeroDataBox filed plan
→ Flight Plan Database simulated plan
→ direct airport-to-airport line
```

Assert each successful result contains the correct kind, source, reference date, explanation, and approximation flag.

**Step 3: Run RED**

```powershell
npm.cmd test -- src/lib/flight
```

Expected: FAIL.

**Step 4: Implement OpenSky adapter**

Use AeroDataBox aircraft ICAO24 when available. Otherwise identify the aircraft through OpenSky flight data using the flight number/callsign, a bounded time window, and exact origin/destination ICAO codes. Query the matched flight timestamp and reject tracks whose time slice or endpoints do not match the confirmed leg. Preserve OpenSky timestamps/elevation and then densify.

**Step 5: Implement filed and simulated routes**

- When AeroDataBox returns a filed route string, resolve recognizable navaids through Flight Plan Database's public navaid search; require the confirmed airport endpoints and at least one usable intermediate point before labeling it `filed-plan`.
- Query Flight Plan Database by exact origin/destination ICAO, sort by popularity, and decode `encodedPolyline` as precision 5. Do not call endpoints that create or modify external flight plans.
- If neither route works, connect the confirmed airports directly, densify linearly to at most 2 km, and use a null reference date.

**Step 6: Add the API route**

Return all provider attempts, including failure categories, but no credentials/raw payloads. Densify and time-interpolate before returning.

**Step 7: Run GREEN**

```powershell
npm.cmd test -- src/lib/flight src/lib/providers/opensky src/lib/providers/flightplandb
npm.cmd run typecheck
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/lib/flight src/lib/providers/opensky src/lib/providers/flightplandb src/app/api/flights/resolve-route
git commit -m "feat: resolve flights through provenance cascade"
```

---

### Task 9: Build the Flight workflow and export

**Files:**
- Create: `src/app/flight/page.tsx`
- Create: `src/components/flight/flight-search-form.tsx`
- Create: `src/components/flight/flight-confirmation-card.tsx`
- Create: `src/components/flight/confirmed-flight-list.tsx`
- Create: `src/components/flight/flight-export-dialog.tsx`
- Create: `src/lib/flight/use-flight-session.ts`
- Test: `src/components/flight/flight-search-form.test.tsx`
- Test: `src/components/flight/confirmed-flight-list.test.tsx`
- Test: `src/app/flight/page.test.tsx`

**Step 1: Write failing component tests**

Cover:

- required flight number and date;
- calendar input;
- one or multiple candidate confirmation;
- exact copy `你搭乘的是否是這個航班？`;
- buttons `是` and `重新輸入`;
- manual airport/time fallback after `no_data`;
- add/edit/delete flights;
- `＋ 新增下一個航班`;
- export confirmation `航班資訊是否無誤？`;
- per-flight progress text `正在搜索第 N 個航班的路線` and `正在將第 N 個航班轉換為 GPX 檔`;
- source/kind/reference-date badges;
- one failed flight does not block later flights.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/components/flight src/app/flight
```

Expected: FAIL.

**Step 3: Implement session state**

Persist only the current confirmed-flight list in `sessionStorage`. Validate loaded state and discard invalid versions. Do not persist provider credentials.

**Step 4: Implement the UI flow**

Use accessible dialogs/cards and native date input. Display airport-local dates, offsets, city, airport name/code, and duration. Keep candidate selection explicit; never auto-confirm the first match.

**Step 5: Implement export**

Resolve flights sequentially so progress order is deterministic. Build one GPX track containing one track segment per successful flight. Include failed flights in the report. Validate before creating the Blob/download URL.

**Step 6: Run GREEN**

```powershell
npm.cmd test -- src/components/flight src/app/flight
npm.cmd run lint
npm.cmd run typecheck
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/app/flight src/components/flight src/lib/flight/use-flight-session.ts
git commit -m "feat: add multi-flight GPX workflow"
```

---

### Task 10: Stream-parse the new Google Timeline format

**Files:**
- Create: `src/test/fixtures/timeline/new-format-sanitized.json`
- Create: `src/lib/timeline/schema.ts`
- Create: `src/lib/timeline/parse-coordinate.ts`
- Create: `src/lib/timeline/stream-parser.ts`
- Create: `src/workers/timeline-parser.worker.ts`
- Create: `src/lib/timeline/worker-protocol.ts`
- Test: `src/lib/timeline/stream-parser.test.ts`
- Test: `src/lib/timeline/parse-coordinate.test.ts`

**Step 1: Create a privacy-safe fixture**

Hand-author a small fixture with the same top-level shape as the user's file:

```json
{
  "semanticSegments": [],
  "rawSignals": [
    { "wifiScan": { "deliveryTime": "2026-01-01T00:00:00Z" } }
  ],
  "userLocationProfile": {}
}
```

Include sanitized visits, activities, timeline paths, multiple UTC offsets, all supported activity types, and one flight. Do not copy names, IDs, times, or coordinates from the user's actual file.

**Step 2: Write failing parser tests**

Feed the parser in small byte chunks and assert:

- only `$.semanticSegments.*` values are retained;
- raw signals and profile objects never appear in output;
- date min/max are computed across all segments rather than array endpoints;
- `##.#######°, ###.#######°`-style points and `latLng` values parse;
- malformed JSON, unsupported top-level schema, invalid coordinates, and missing time are reported with counts;
- parser progress is monotonic.

**Step 3: Run RED**

```powershell
npm.cmd test -- src/lib/timeline/stream-parser.test.ts src/lib/timeline/parse-coordinate.test.ts
```

Expected: FAIL.

**Step 4: Implement streaming parse**

Use `File.stream().getReader()` in the worker and `@streamparser/json` with the `$.semanticSegments.*` path. Post batched progress/events, not one message per point. Retain normalized semantic segments only.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/timeline/stream-parser.test.ts src/lib/timeline/parse-coordinate.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/test/fixtures/timeline src/lib/timeline src/workers
git commit -m "feat: parse Timeline exports in a worker"
```

---

### Task 11: Normalize Timeline activities and identify repair gaps

**Files:**
- Create: `src/lib/timeline/activity-mode.ts`
- Create: `src/lib/timeline/date-range.ts`
- Create: `src/lib/timeline/build-legs.ts`
- Create: `src/lib/timeline/detect-flight.ts`
- Test: `src/lib/timeline/activity-mode.test.ts`
- Test: `src/lib/timeline/date-range.test.ts`
- Test: `src/lib/timeline/build-legs.test.ts`

**Step 1: Write failing mode/date tests**

Map Google types:

```text
WALKING → walking
RUNNING → running
CYCLING → cycling
MOTORCYCLING → motorcycling
IN_PASSENGER_VEHICLE → driving
IN_TRAIN → train
IN_SUBWAY → subway
IN_BUS → bus
IN_TRAM → tram
IN_FERRY → ferry
FLYING → flying
anything else → unknown
```

Assert date selection is inclusive and compares the local date embedded in each RFC3339 timestamp, not the computer timezone. Dates outside the discovered range are rejected.

**Step 2: Write failing leg/gap tests**

Assert:

- recorded timeline-path points are sorted/deduplicated;
- activity endpoints are used when fewer than two recorded points fall inside an activity;
- pairs at or below 2 km remain recorded;
- pairs over 2 km become repair candidates;
- explicit flying splits the track;
- probable flying requires high distance/speed plus failure to find land/transit routing; it is never classified from distance alone;
- unmatched timeline paths still become legs;
- no direct line crosses a flight or unresolved gap.

**Step 3: Run RED**

```powershell
npm.cmd test -- src/lib/timeline/activity-mode.test.ts src/lib/timeline/date-range.test.ts src/lib/timeline/build-legs.test.ts
```

Expected: FAIL.

**Step 4: Implement normalization**

Use activities as primary legs, attach timeline points by time overlap, and create deterministic IDs from timestamps plus rounded endpoints. Keep original activity probability for reporting, not routing decisions.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/timeline
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/timeline
git commit -m "feat: normalize Timeline legs and gaps"
```

---

### Task 12: Add OpenRouteService, Transitous, reverse geocoding, and IndexedDB cache

**Files:**
- Create: `src/lib/providers/openrouteservice/client.ts`
- Create: `src/lib/providers/transitous/client.ts`
- Create: `src/lib/routing/mode-policy.ts`
- Create: `src/lib/routing/repair-route.ts`
- Create: `src/lib/client/route-cache.ts`
- Create: `src/app/api/routes/repair/route.ts`
- Create: `src/app/api/geocode/reverse/route.ts`
- Test: `src/lib/routing/repair-route.test.ts`
- Test: `src/lib/client/route-cache.test.ts`

**Step 1: Write failing provider-policy tests**

Assert:

- walking/running use ORS foot;
- cycling uses ORS cycling;
- motorcycle/driving use ORS driving;
- train/subway/bus/tram/ferry use Transitous;
- unknown mode does not silently select driving;
- Transitous routes are always approximate with their actual query date as reference date.

**Step 2: Write failing cache tests**

Using `fake-indexeddb`, prove keys include rounded endpoints, mode, provider, route algorithm version, and a month bucket for transit. Prove cache and user corrections are separate stores and that clearing cache does not delete corrections.

**Step 3: Run RED**

```powershell
npm.cmd test -- src/lib/routing src/lib/client/route-cache.test.ts
```

Expected: FAIL.

**Step 4: Implement ORS**

POST coordinates to the correct directions profile and map GeoJSON `[lon, lat]` to `GeoPoint`. Use ORS reverse geocoding for human-readable review locations; if geocoding fails, return coordinates only.

**Step 5: Implement Transitous**

Call the production MOTIS `/api/v5/plan` endpoint using current time, exact endpoint coordinates, selected transit modes, and walking access legs. Decode returned polylines as precision 6. Send a `User-Agent` containing app name/version and `TRANSITOUS_CONTACT_URL`; disable Transitous with a setup error if the contact URL is missing/placeholder.

**Step 6: Implement repair API**

Validate endpoints/mode/time, call the selected provider, densify the returned route, and return attempts plus provenance. Do not cache on the server; cache normalized results in IndexedDB after success.

**Step 7: Run GREEN**

```powershell
npm.cmd test -- src/lib/routing src/lib/providers/openrouteservice src/lib/providers/transitous src/lib/client
npm.cmd run typecheck
```

Expected: PASS.

**Step 8: Commit**

```powershell
git add src/lib/providers/openrouteservice src/lib/providers/transitous src/lib/routing src/lib/client src/app/api/routes src/app/api/geocode
git commit -m "feat: repair ground and transit routes"
```

---

### Task 13: Build the Timeline processing pipeline and report

**Files:**
- Create: `src/lib/timeline/process-timeline.ts`
- Create: `src/lib/timeline/report.ts`
- Test: `src/lib/timeline/process-timeline.test.ts`
- Test: `src/lib/timeline/report.test.ts`

**Step 1: Write failing pipeline tests**

Inject cache and route-repair functions. Cover:

- recorded points retained without provider calls;
- multiple gaps in one leg process deterministically;
- cached routes avoid provider calls;
- successful repair has provider provenance;
- explicit flight splits output and records a skipped-flight item;
- all-source failure splits output and queues an unresolved item;
- later legs continue after failure;
- cancellation aborts future provider calls and returns no downloadable artifact;
- every successful segment is densified to 2 km;
- a zero-segment result is not downloadable;
- partial success is downloadable with a warning.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/lib/timeline/process-timeline.test.ts src/lib/timeline/report.test.ts
```

Expected: FAIL.

**Step 3: Implement processing**

Use this order per gap:

1. Apply a saved user correction if present.
2. Skip/split explicit flight.
3. Use the Google mode when supported.
4. Fetch or reuse the appropriate provider repair.
5. If route lookup fails and high distance/speed suggests a flight, report probable flight.
6. Otherwise queue unresolved review and split the track.

Emit progress for parsing, classification, repair `M/N`, GPX creation, and validation. Use `AbortSignal` for every external call.

**Step 4: Implement report aggregation**

Return counts and detailed items for automatic success, user-corrected success, user-excluded segments, skipped flights, unresolved gaps, invalid data, and provider attempts.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/lib/timeline/process-timeline.test.ts src/lib/timeline/report.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/timeline
git commit -m "feat: process Timeline routes with partial success"
```

---

### Task 14: Implement the unresolved-segment review queue

**Files:**
- Create: `src/lib/client/correction-store.ts`
- Create: `src/components/timeline/unresolved-review.tsx`
- Create: `src/components/timeline/unresolved-card.tsx`
- Create: `src/components/timeline/transport-mode-select.tsx`
- Test: `src/lib/client/correction-store.test.ts`
- Test: `src/components/timeline/unresolved-review.test.tsx`

**Step 1: Write failing review tests**

Assert each card shows:

- local start/end time;
- reverse-geocoded names or coordinate fallback;
- straight-line distance and elapsed time;
- original Google mode;
- all attempted sources/failure reasons;
- probable-flight/position-anomaly warning when applicable.

Assert actions:

- choose a corrected mode and `重新查詢`;
- `此路段不存在` stores an intentional exclusion;
- `暫時略過` leaves the segment unresolved;
- successful retry records original mode, corrected mode, final source, and `使用者修正`;
- failed retry remains in the queue;
- the queue appears after automatic processing, not as a blocking popup during it.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/components/timeline/unresolved-review.test.tsx src/lib/client/correction-store.test.ts
```

Expected: FAIL.

**Step 3: Implement persistent corrections**

Key corrections by deterministic segment ID and parser/schema version. Store only the chosen action/mode and normalized route result; never store the uploaded raw JSON.

**Step 4: Implement the review UI**

Process retries one card at a time while allowing navigation among cards. Rebuild the affected GPX segment/report after each decision. Treat `不存在` as intentional exclusion, not a failure.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/components/timeline/unresolved-review.test.tsx src/lib/client/correction-store.test.ts
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/components/timeline src/lib/client/correction-store.ts
git commit -m "feat: add human review for unresolved routes"
```

---

### Task 15: Build the Timeline page, date selection, report, and export

**Files:**
- Create: `src/app/timeline/page.tsx`
- Create: `src/components/timeline/timeline-uploader.tsx`
- Create: `src/components/timeline/date-range-selector.tsx`
- Create: `src/components/timeline/timeline-report.tsx`
- Test: `src/components/timeline/timeline-uploader.test.tsx`
- Test: `src/components/timeline/date-range-selector.test.tsx`
- Test: `src/app/timeline/page.test.tsx`

**Step 1: Write failing UI tests**

Cover:

- heading `上傳你的 Google 時間軸`;
- button and drag/drop upload;
- `.json` validation and unsupported-schema message;
- `上傳完成`;
- discovered date range;
- mutually exclusive `全部時間` and `選取區間`;
- dates outside the file range disabled;
- inclusive valid range;
- export button only after selection;
- progress, cancel, review queue, final report, file size, and download;
- final report explicitly lists all-source failures;
- no download when zero routes;
- partial completion warning when unresolved gaps remain.

**Step 2: Run RED**

```powershell
npm.cmd test -- src/components/timeline src/app/timeline
```

Expected: FAIL.

**Step 3: Implement upload and date selection**

Transfer the `File` to the worker; do not POST it. Warn before parsing very large files but allow the user to proceed. Revoke object URLs and terminate workers on reset/unmount.

**Step 4: Implement processing/export**

Generate `TimelineRouteYYMMDD.gpx`, validate it, show report/source summary/file size, and enable download only after validation. Write unresolved/excluded/skipped counts into GPX metadata.

**Step 5: Run GREEN**

```powershell
npm.cmd test -- src/components/timeline src/app/timeline
npm.cmd run lint
npm.cmd run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/app/timeline src/components/timeline
git commit -m "feat: add Timeline GPX workflow"
```

---

### Task 16: Add open-source documentation, attribution, CI, and end-to-end acceptance

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`
- Create: `e2e/home.spec.ts`
- Create: `e2e/flight.spec.ts`
- Create: `e2e/timeline.spec.ts`
- Create: `e2e/privacy.spec.ts`
- Modify: `src/app/data-sources/page.tsx`

**Step 1: Write failing E2E tests**

Mock same-origin API routes in Playwright. Verify:

- home exposes `航班` and `時間軸`;
- multi-flight confirmation and export creates `FlightRouteYYMMDD.gpx`;
- route badges show kind, source, and reference date;
- Timeline upload/date selection/export creates `TimelineRouteYYMMDD.gpx`;
- unresolved review can correct, exclude, or postpone;
- final report categories match GPX metadata;
- intercepted network requests never contain the raw Timeline JSON, `wifiScan`, or profile fields.

**Step 2: Run RED**

```powershell
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Expected: tests initially fail where flows/fixtures are incomplete.

**Step 3: Complete documentation and attribution**

README must include:

- local installation and `npm.cmd` Windows commands;
- `.env.local` setup and provider capability matrix;
- privacy statement;
- approximate-route warning;
- 30/100-day flight rules;
- current-network limitation for historical transit;
- review-queue behavior;
- GPX metadata/extension description;
- testing commands;
- data source and license/use links for AeroDataBox, OpenSky, Flight Plan Database, OpenRouteService, OpenStreetMap, Transitous, and Google Timeline input;
- Transitous best-effort/open-source/contact requirements;
- confirmation that personal Timeline fixtures are never committed.

Use the MIT license. Mirror essential attribution in `/data-sources`.

**Step 4: Add CI**

On push/PR run:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

Do not call live providers in CI.

**Step 5: Run full verification**

Follow @Verification Before Completion and run fresh:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
git status --short
```

Expected: all commands exit 0; Git shows only intentional documentation/test changes before the final commit.

**Step 6: Perform local private acceptance**

Using the original Timeline file outside the repository, supplied through an untracked local path such as `$env:TIMELINE_ACCEPTANCE_FILE`:

- verify the detected range matches the user's local expectation without writing that private range into tracked files;
- verify parsing occurs in a worker and UI remains responsive;
- inspect browser network and confirm the raw file is never uploaded;
- process a small selected range first;
- process the full range only after provider quotas/configuration are confirmed;
- verify every emitted segment passes the 2 km invariant;
- verify skipped flights, unresolved routes, exclusions, and source/reference-date labels agree between UI and GPX.

Do not commit the acceptance output.

**Step 7: Commit**

```powershell
git add README.md LICENSE .github e2e src/app/data-sources
git commit -m "docs: add attribution and acceptance coverage"
```

---

## Final handoff checklist

- [ ] All production behavior was preceded by a failing test.
- [ ] The real Timeline file and coordinates are absent from Git history.
- [ ] Provider keys are server-only and absent from client bundles.
- [ ] Flight route source/kind/reference date appears in cards and GPX.
- [ ] Timeline raw data never leaves the browser.
- [ ] Unresolved routes enter review rather than becoming straight lines.
- [ ] User corrections persist locally and appear in GPX extensions.
- [ ] Final report and GPX metadata counts agree.
- [ ] Every adjacent point inside every emitted track segment is at most 2 km apart.
- [ ] README and `/data-sources` contain all required attribution.
- [ ] Lint, typecheck, unit/component tests, build, and Playwright all pass with fresh evidence.
