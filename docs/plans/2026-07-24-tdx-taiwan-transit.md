# TDX Taiwan Transit Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Route public-transport repairs wholly inside Taiwan through TDX MaaS while retaining Transitous for supported routes outside Taiwan.

**Architecture:** Keep provider selection deterministic and shared by the browser cache and server repair path: both endpoints must fall inside a conservative Taiwan-region set before TDX is selected. A server-only TDX adapter obtains and caches an OAuth2 client-credentials token, queues all MaaS attempts behind a shared per-process rolling-window limit of five requests per minute, calls `GET /api/maas/routing`, decodes HERE flexible polylines (falling back to section endpoints), and returns the same point/reference-date shape as Transitous. Provenance and cache keys record the concrete provider.

**Tech Stack:** Next.js 16, TypeScript, Zod, Vitest, Testing Library, IndexedDB (`idb`)

---

### Task 1: Add Taiwan-aware provider selection

**Files:**
- Create: `src/lib/geo/taiwan.ts`
- Create: `src/lib/geo/taiwan.test.ts`
- Modify: `src/lib/routing/mode-policy.ts`
- Modify: `src/lib/routing/repair-route.test.ts`

**Step 1: Write the failing tests**

Test representative points on Taiwan proper, Penghu, Kinmen, and Matsu, plus nearby non-Taiwan points. Test that:

```ts
routePolicy("bus", taipei, kaohsiung)?.provider === "tdx";
routePolicy("bus", tokyo, yokohama)?.provider === "transitous";
```

**Step 2: Run tests to verify they fail**

Run:

```powershell
npm.cmd test -- src/lib/geo/taiwan.test.ts src/lib/routing/repair-route.test.ts
```

Expected: FAIL because `isTaiwanPoint` does not exist and transit modes still always select Transitous.

**Step 3: Write minimal implementation**

Implement `isTaiwanPoint(point)` using explicit conservative bounding boxes for Taiwan proper and populated offshore island groups. Extend `routePolicy(mode, startPoint?, endPoint?)` so public transport selects TDX only when both endpoints are in those regions.

**Step 4: Run tests to verify they pass**

Run the same focused command. Expected: PASS.

### Task 2: Decode TDX route geometry

**Files:**
- Create: `src/lib/geo/flexible-polyline.ts`
- Create: `src/lib/geo/flexible-polyline.test.ts`

**Step 1: Write the failing tests**

Use HERE's published `BFoz5xJ67i1B1B7PzIhaxL7Y` example and assert the four decoded latitude/longitude pairs. Add invalid-input coverage.

**Step 2: Run test to verify it fails**

```powershell
npm.cmd test -- src/lib/geo/flexible-polyline.test.ts
```

Expected: FAIL because the decoder does not exist.

**Step 3: Write minimal implementation**

Decode version, header precision, signed deltas, and optional third-dimension values without 32-bit bitwise accumulation.

**Step 4: Run test to verify it passes**

Run the focused test. Expected: PASS.

### Task 3: Add the authenticated TDX MaaS client

**Files:**
- Create: `src/lib/providers/tdx/client.ts`
- Create: `src/lib/providers/tdx/client.test.ts`
- Modify: `src/lib/server/env.ts`

**Step 1: Write the failing tests**

Cover:

```ts
createTdxClient({ clientId: undefined, clientSecret: undefined });
```

throwing a configuration error; OAuth2 form fields; bearer authorization; per-mode `transit` values; current Taipei reference date; flexible-polyline decoding; endpoint fallback; malformed/no-route payloads; and reuse of a non-expired token.

**Step 2: Run test to verify it fails**

```powershell
npm.cmd test -- src/lib/providers/tdx/client.test.ts
```

Expected: FAIL because the client does not exist.

**Step 3: Write minimal implementation**

POST client credentials to:

```text
https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token
```

Then call:

```text
https://tdx.transportdata.tw/api/maas/routing
```

with `origin`, `destination`, `gc=1`, `top=1`, mode-specific `transit`, walking first/last mile, and `Authorization: Bearer …`. Validate external JSON with Zod and never expose credentials or tokens.

**Step 4: Run test to verify it passes**

Run the focused test. Expected: PASS.

### Task 4: Wire concrete providers through repair, cache, and provenance

**Files:**
- Modify: `src/lib/routing/repair-route.ts`
- Modify: `src/lib/routing/repair-route.test.ts`
- Modify: `src/app/api/routes/repair/route.ts`
- Modify: `src/lib/timeline/process-timeline.ts`
- Modify: `src/lib/client/route-cache.ts`
- Modify: `src/lib/client/route-cache.test.ts`
- Modify: `src/app/timeline/page.tsx`
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/provenance.ts`
- Modify: `src/lib/domain/provenance.test.ts`

**Step 1: Write the failing tests**

Assert that a Taiwan bus repair calls only `tdx`, records `source: "tdx"`, and uses a date-bucketed TDX cache key. Assert that an overseas transit repair continues to call only Transitous.

**Step 2: Run tests to verify they fail**

```powershell
npm.cmd test -- src/lib/routing/repair-route.test.ts src/lib/client/route-cache.test.ts src/lib/domain/provenance.test.ts
```

Expected: FAIL because TDX is not yet a route source or repair dependency.

**Step 3: Write minimal implementation**

Select the concrete provider from mode plus endpoints, call the matching dependency, record provider-specific explanation/provenance, and include `tdx` in public-transit monthly cache bucketing.

**Step 4: Run tests to verify they pass**

Run the focused test command. Expected: PASS.

### Task 5: Expose configuration and document the privacy/source boundary

**Files:**
- Modify: `.env.example`
- Modify: `src/app/api/config/status/route.ts`
- Modify: `src/app/api/config/status/route.test.ts`
- Modify: `src/app/data-sources/page.tsx`
- Modify: `src/app/data-sources/page.test.tsx`
- Modify: `README.md`

**Step 1: Write the failing tests**

Assert that TDX is configured only when both credentials exist, serialized config status never contains either credential, and the data-source page links to the official TDX platform/API.

**Step 2: Run tests to verify they fail**

```powershell
npm.cmd test -- src/app/api/config/status/route.test.ts src/app/data-sources/page.test.tsx
```

Expected: FAIL because TDX is absent from status and source disclosures.

**Step 3: Write minimal implementation**

Add `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`, status copy, data-source/limitation copy, and README setup instructions. State that only repair endpoints/mode reach TDX and that current-network results remain historical approximations.

**Step 4: Run tests to verify they pass**

Run the focused test command. Expected: PASS.

### Task 6: Full verification

**Files:**
- Verify all modified files

**Step 1: Run complete automated checks**

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

Expected: all commands exit 0 with no test failures, lint errors, type errors, or build errors.

**Step 2: Inspect the final diff**

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only TDX/provider-selection tests, implementation, configuration, and documentation changes; no secrets or generated artifacts.
