# Timeline Routing Lanes and Live Review Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** 讓 Timeline 路線先依地區與交通方式分派到 OpenRouteService、Transitous、TDX 三條自動處理線，失敗項目即時進入可插隊回送的人工審查線，並在分派前合併三分鐘內相鄰且交通方式相同的大眾運輸路段。

**Architecture:** 先在目前任務窗把 `processTimeline()` 內的兩條區域迴圈重構成共用 `RoutingLane` 模板：三個 provider adapter 共用相同的 priority queue、事件、取消與失敗轉人工流程，差異只由 adapter 與 `RequestRateLimiter` 設定注入。OpenRouteService、TDX、Transitous 的實際限流（包含 Transitous 5 秒禮貌性間隔）也在核心框架階段完成；之後人工審查與相鄰同交通方式大眾運輸路段合併，從同一個 framework commit 分成兩個任務窗並行實作。

**Tech Stack:** Next.js 16、React 19、TypeScript、Vitest、Testing Library、Playwright、IndexedDB (`idb`)、TDX MaaS、Transitous MOTIS v6、OpenRouteService Directions。

---

## 執行與任務窗約束

本計畫尚未授權功能實作。收到使用者明確確認後，依下列拓樸執行：

1. **目前任務窗：核心框架。** 完成共用 `RoutingLane`、三線分派、failure → review event、manual priority 回送契約、共用 `RequestRateLimiter`、三家 provider 實際限流與路徑前處理接點。完成完整驗證並建立 framework commit；不 push、不開 PR。
2. **同時建立新任務窗 A 與 B。** 兩者都從完全相同的 framework commit 開始：
   - **任務窗 A：第 1＋3 點。** 國內外人工選項、即時 review queue、人工插隊、成功通知與 UI/E2E。
   - **任務窗 B：第 4 點。** 三分鐘內相鄰且交通方式相同的大眾運輸路段合併，只透過核心框架預留的 `prepareTimelineLegs()` 接點整合。
3. **回到目前任務窗整合。** 等 A、B 都完成後，分別檢查 diff、測試與交接 commit，再整合兩者並執行全套 regression verification。

不再建立獨立 Transitous 任務窗；5 秒設定與測試屬於目前任務窗的共用限流框架。A、B 可同時執行，但不能自行合併彼此分支，也不能修改對方的檔案所有權。若 Codex 任務工具使用獨立 worktree，兩個任務都必須回報 commit SHA，由目前任務窗統一整合到 `codex/reuse-completed-tdx-routes`。

下方章節沿用原始需求編號方便核對，不代表閱讀順序。實際執行必須先做 **Task 2.1～2.5**；通過 framework gate 後，任務窗 A 執行 **Task 1.1～1.4，再接 Task 3.1～3.5**，同時任務窗 B 執行 **Task 4.1～4.4**。

為解除 A、B 的型別依賴，framework commit 必須先凍結完整 `TransportMode` vocabulary（包含 TDX 與 MOTIS 使用的精確模式）、`modeFamily()`、provider mode maps、`routePolicy()` 分派與 repair request schema。平行任務窗 A 不再新增或改名 mode identifier，只把已存在的穩定值組成國內外選單；平行任務窗 B 只比較穩定 identifier 是否相同，並以共用 `modeFamily()` 判定是否為大眾運輸，不建立自己的交通方式例外清單。

主要檔案所有權：

| 階段 | 所有權 |
|---|---|
| 目前任務核心 | `routing-lane.ts`、`route-scheduler.ts`、`process-timeline.ts`、provider clients、通用 limiter/fetch、server env/API handler、domain mode vocabulary、provider mode maps、repair schema |
| 任務窗 A | `review-mode-catalog.ts`、timeline review components、`app/timeline/page.tsx`、人工審查相關 tests/E2E |
| 任務窗 B | `coalesce-adjacent-transit-legs.ts`、`prepare-timeline-legs.ts` 及其 tests；只可增加必要的 processing integration test |

## 已查證的外部契約

### 交通方式

- TDX MaaS 官方列出的台灣運具涵蓋公車、雙鐵、捷運、輕軌、纜車、渡輪與公共自行車：
  `https://tdx.transportdata.tw/api-service/swagger/maas/4513f9d6-caae-4cf7-a50c-e7887bec804e`
- Transitous 使用 MOTIS v6。官方 `Mode` 包含 `TRANSIT`、`TRAM`、`SUBWAY`、`FERRY`、`BUS`、`COACH`、`RAIL`、`HIGHSPEED_RAIL`、`LONG_DISTANCE`、`NIGHT_RAIL`、`REGIONAL_RAIL`、`SUBURBAN`、`FUNICULAR`、`AERIAL_LIFT`、`OTHER` 等：
  `https://raw.githubusercontent.com/motis-project/motis/refs/tags/v2.10.2/openapi.yaml`

人工審查採下列 catalog；一般路線在兩區都顯示：

| 群組 | 畫面選項 | 內部模式／provider 參數 |
|---|---|---|
| 一般路線 | 步行、跑步、自行車、機車、開車 | 現有 OpenRouteService profiles |
| 台灣大眾運輸 | 鐵路（台鐵／高鐵，不限）、台鐵、高鐵、公車／公路客運、捷運、輕軌、渡輪、纜車 | TDX `transit` 對應值；保留現有廣義 `train`，新增精確模式 |
| 國外大眾運輸 | 大眾運輸（不限）、鐵路（不限）、高速鐵路、長途鐵路、夜行列車、區域鐵路、市郊鐵路、地鐵、市區／短途公車、長途客運、路面電車、渡輪、登山纜車、空中纜車、其他大眾運輸 | 對應 MOTIS v6 enum |

不把 `AIRPLANE` 放入人工審查選單，因為飛行已有獨立工作流。也不先納入 MOTIS 的實驗性 `ODM`、`FLEX`、`RIDE_SHARING`。

區域判定規則：

- 起點與終點都在台灣：`taiwan`，使用表格中的台灣大眾運輸選項並送往 TDX。
- 其餘（包含跨境）：`international`，使用表格中的國外大眾運輸選項並送往 Transitous。
- 一般 OpenRouteService 選項不受區域限制。
- 國內外判定只讀取起點與終點；原始交通方式、顯示名稱或任一個別選項都不得參與地區分類。

### API 頻率

| Provider | 官方現況（查證日 2026-07-26） | 程式行為 |
|---|---|---|
| OpenRouteService Directions | Standard plan 預設 2,000 次／24 小時、40 次／任一滾動 60 秒 | Directions 每次嘗試（含 retry）走共用 40/60s limiter；2,000/24h 只在 README 備註 |
| TDX MaaS | 官方說明頻率依會員訂閱方案而異；目前專案保守值為 5/60s | 共用 sliding-window limiter，預設 5/60s；增加環境設定以對齊實際帳戶，README 說明官方帳戶頁為準 |
| Transitous | 官方沒有公布固定的每分鐘或每日次數；要求大量或昂貴 routing 前先聯絡 | 明確標示為本專案禮貌性保守值：同時間一筆、每次 HTTP attempt（含 retry）至少間隔 5 秒，約最多 12 attempts/min；429 另外遵守 `Retry-After`。可用環境變數調慢或在合理範圍內調整，但不得把 5 秒寫成官方額度 |

官方參考：

- OpenRouteService quota：
  `https://giscience.github.io/openrouteservice/frequently-asked-questions.html#when-and-how-does-my-quota-reset`
- Transitous usage policy：
  `https://transitous.org/api/`
- TDX MaaS 與方案限制：
  `https://tdx.transportdata.tw/api-service/swagger/maas/4513f9d6-caae-4cf7-a50c-e7887bec804e`

Transitous 的操作性邊界不是官方配額，也不作為硬性 batch 上限：

- 偶發、單一使用者的處理仍維持一條 Transitous lane。
- README 建議每次偶發批次約 10～20 筆以內。
- 若一次可能超過 20 筆、短時間重複匯入或部署成多人服務，先到 Transitous 官方 Matrix 頻道說明 use case。
- 程式限制的是每次 HTTP attempt 的最小間隔；單次 batch 筆數只做文件提醒，避免用未經官方承諾的數字拒絕使用者資料。

## 平行任務窗 A（第 1 點部分）：人工審查依國內外顯示 provider-aware 選項

### Task 1.1：先用測試固定區域與選項 catalog

**Files:**

- Create: `src/lib/routing/review-mode-catalog.ts`
- Create: `src/lib/routing/review-mode-catalog.test.ts`
- Modify: `src/lib/domain/provenance.ts`
- Modify: `src/lib/domain/provenance.test.ts`

**Step 1: Write failing tests**

測試：

1. 台灣起訖點回傳 `taiwan`，跨境或海外回傳 `international`。
2. 對相同起訖點改變原始交通方式或顯示名稱，區域結果不變，證明分類只依起點與終點。
3. 一般路線在兩區都出現。
4. `taiwan` 與 `international` 的完整選項集合分別精確符合上方 catalog 表格，不為任一個別交通方式撰寫特殊分支。
5. TDX 與 MOTIS 精確模式只出現在正確地區。
6. `AIRPLANE`、`ODM`、`FLEX`、`RIDE_SHARING` 不出現。

**Step 2: Verify RED**

Run:

```powershell
npm.cmd test -- src/lib/routing/review-mode-catalog.test.ts src/lib/domain/provenance.test.ts
```

Expected: FAIL because provider-aware catalog and detailed repair modes do not exist.

**Step 3: Implement the catalog**

建立：

```ts
export type ReviewRegion = "taiwan" | "international";

export interface ReviewModeOption {
  value: TransportMode;
  label: string;
  group: "general" | "transit";
}

export function reviewRegion(
  startPoint: GeoPoint,
  endPoint: GeoPoint,
): ReviewRegion;

export function reviewModeOptions(
  region: ReviewRegion,
): readonly ReviewModeOption[];
```

使用 framework commit 已凍結的精確 TDX／MOTIS mode identifiers。不要在任務窗 A 新增、刪除或重新命名 `TransportMode`；IndexedDB、cache key 與 API request 都沿用穩定英文 identifier。

**Step 4: Verify GREEN**

Run the focused tests again. Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/domain/provenance.ts src/lib/domain/provenance.test.ts src/lib/routing/review-mode-catalog.ts src/lib/routing/review-mode-catalog.test.ts
git commit -m "feat: add regional review mode catalog"
```

### Task 1.2：驗證區域選項沿用 framework provider mapping

**Files:**

- Modify: `src/lib/routing/review-mode-catalog.ts`
- Modify: `src/lib/routing/review-mode-catalog.test.ts`
- Modify: `src/lib/routing/repair-route.test.ts`
- Modify: `src/lib/providers/tdx/mode-map.test.ts`
- Modify: `src/lib/providers/tdx/client.test.ts`
- Modify: `src/lib/providers/transitous/mode-map.test.ts`
- Modify: `src/lib/providers/transitous/client.test.ts`
- Modify: `src/lib/routing/repair-request-schema.test.ts`
- Modify: `src/lib/client/route-cache.test.ts`

**Step 1: Write failing table tests**

每個人工選項都必須：

1. 選到唯一正確 provider。
2. 產生正確 TDX transit code 或 MOTIS `transitModes`。
3. 進入包含 mode 的獨立 cache key。
4. 台灣精確模式不能誤送 Transitous；國外精確模式不能誤送 TDX。

**Step 2: Verify RED**

Run:

```powershell
npm.cmd test -- src/lib/routing/repair-route.test.ts src/lib/providers/tdx/client.test.ts src/lib/providers/transitous/client.test.ts src/lib/client/route-cache.test.ts
```

**Step 3: Connect catalog without changing mappings**

所有 provider mappings、request schema 與 `routePolicy()` 已由 framework commit 提供。此步只讓 review catalog 選項使用正確穩定值；若測試發現 framework mapping 缺漏，停止並回報目前任務窗，不在 A 任務自行修改 provider client 或核心 schema。

**Step 4: Verify GREEN and commit**

```powershell
git add src/lib/routing/review-mode-catalog.ts src/lib/routing/review-mode-catalog.test.ts src/lib/routing/repair-route.test.ts src/lib/providers/tdx/mode-map.test.ts src/lib/providers/tdx/client.test.ts src/lib/providers/transitous/mode-map.test.ts src/lib/providers/transitous/client.test.ts src/lib/routing/repair-request-schema.test.ts src/lib/client/route-cache.test.ts
git commit -m "test: verify regional transit review mappings"
```

### Task 1.3：更新人工審查 UI

**Files:**

- Modify: `src/components/timeline/transport-mode-select.tsx`
- Create: `src/components/timeline/transport-mode-select.test.tsx`
- Modify: `src/components/timeline/unresolved-card.tsx`
- Modify: `src/components/timeline/unresolved-review.tsx`
- Modify: `src/components/timeline/unresolved-review.test.tsx`
- Modify: `src/app/timeline/page.test.tsx`
- Modify: `e2e/timeline.spec.ts`

**Step 1: Write failing UI tests**

以台灣、海外與跨境 fixture 測試各自的完整 `<optgroup>`、初始值與送出的 mode。區域只由 fixture 的起終點決定；測試不針對任一個別交通方式建立特殊案例。

**Step 2: Verify RED**

```powershell
npm.cmd test -- src/components/timeline/transport-mode-select.test.tsx src/components/timeline/unresolved-review.test.tsx src/app/timeline/page.test.tsx
```

**Step 3: Implement**

`TransportModeSelect` 接收整個 review item 或 `ReviewRegion`，由 catalog 產生選項。若 Google 原始 mode 是廣義值，選擇該地區可用的廣義相容項；不可讓 `<select value>` 指向不存在的 option。

**Step 4: Verify and commit**

```powershell
npm.cmd test -- src/components/timeline/transport-mode-select.test.tsx src/components/timeline/unresolved-review.test.tsx src/app/timeline/page.test.tsx
git add src/components/timeline src/app/timeline/page.test.tsx e2e/timeline.spec.ts
git commit -m "feat: localize timeline review choices"
```

### Task 1.4：第 1 點局部驗證

Run:

```powershell
npm.cmd test -- src/lib/routing/review-mode-catalog.test.ts src/components/timeline/transport-mode-select.test.tsx src/components/timeline/unresolved-review.test.tsx src/app/timeline/page.test.tsx
npm.cmd run lint
npm.cmd run typecheck
git diff --check
git status --short --branch
```

Expected: focused tests、lint、typecheck 全部成功；完整 build/E2E 留到同一任務窗完成 Task 3.5 後執行，避免中途重複耗時。此時同一個任務窗 A 直接接著執行下方第 3 點，不要先結束或要求目前任務窗整合半成品。

## 目前任務窗（核心框架）：三條 provider 線＋一條人工審查線＋三家限流

### Task 2.1：定義共用 lane template、provider adapter、processing session 與事件契約

**Files:**

- Create: `src/lib/timeline/route-job.ts`
- Create: `src/lib/timeline/routing-lane.ts`
- Create: `src/lib/timeline/routing-lane.test.ts`
- Create: `src/lib/timeline/route-scheduler.ts`
- Create: `src/lib/timeline/route-scheduler.test.ts`
- Create: `src/lib/routing/provider-adapter.ts`
- Create: `src/lib/server/request-rate-limiter.ts`
- Create: `src/lib/server/rate-limited-fetch.ts`
- Create: `src/lib/server/rate-limited-fetch.test.ts`
- Create: `src/lib/timeline/prepare-timeline-legs.ts`
- Modify: `src/lib/timeline/process-timeline.ts`
- Modify: `src/lib/timeline/process-timeline.test.ts`

**Required contracts:**

```ts
export type AutomaticLane =
  | "openrouteservice"
  | "transitous"
  | "tdx";

export type JobPriority = "automatic" | "manual";

export interface RequestRateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}

export interface RoutingProviderAdapter {
  id: AutomaticLane;
  route(
    job: RoutingJob,
    signal?: AbortSignal,
  ): Promise<RepairRouteResult>;
}

export interface RoutingLaneConfig {
  adapter: RoutingProviderAdapter;
  concurrency: 1;
}

export interface RoutingLane {
  enqueue(job: RoutingJob, priority: JobPriority): Promise<RepairRouteResult>;
  cancel(reason?: unknown): void;
}

export type TimelineProcessingEvent =
  | { type: "route-succeeded"; gapId: string; lane: AutomaticLane }
  | { type: "review-enqueued"; item: ReviewQueueItem }
  | { type: "review-removed"; gapId: string }
  | { type: "progress"; progress: TimelineProgress };

export interface TimelineProcessingSession {
  automaticDone: Promise<ProcessTimelineResult>;
  finished: Promise<ProcessTimelineResult>;
  submitReview(decision: ReviewDecision): Promise<void>;
  cancel(): void;
}
```

`createRoutingLane(config)` 是唯一的 lane 流程實作，統一處理 automatic/manual priority、active job、取消、成功、失敗與下一筆工作。OpenRouteService、Transitous、TDX 不各自重寫 worker，只注入不同 adapter。

`startTimelineProcessing()` 同步回傳 session，使用三個 `createRoutingLane()` instance；三線彼此並行，每線 `concurrency: 1`。人工審查是第四條狀態線，接收三條自動線失敗事件；`submitReview()` 將工作以 `manual` priority 放回重新分類後的正確 provider lane。

`ReviewQueueItem` 定義在 `src/lib/timeline/route-job.ts`，核心 library 不可 import React component type。`automaticDone` 在三條 automatic lane idle 後解析，即使仍有 review items；`finished` 只有 automatic lanes idle、沒有 active manual job 且 review queue 為空時解析。相容 `processTimeline()` wrapper 暫時等待 `automaticDone`，避免第 3 點 UI 完成前發生死鎖；平行任務窗 A 改用 events + `finished`。

`prepareTimelineLegs(legs)` 在核心框架階段先是 identity seam：

```ts
export function prepareTimelineLegs(
  legs: readonly TimelineLeg[],
): TimelineLeg[] {
  return [...legs];
}
```

`startTimelineProcessing()` 必須在建立 routing jobs 前呼叫它。平行任務窗 B 只修改這個 seam 與新增 coalescing 純函式，不再碰 scheduler 或 page。

`createRateLimitedFetch(fetchFn, limiter)` 統一確保每個實際 HTTP attempt 都取得 slot：

```ts
export function createRateLimitedFetch(
  fetchFn: typeof fetch,
  limiter: RequestRateLimiter,
): typeof fetch {
  return async (input, init) => {
    await limiter.acquire(init?.signal);
    return fetchFn(input, init);
  };
}
```

各 provider 的 `fetchWithRetry()` 都接收這個 wrapped fetch；不能只在 lane job 外層取得一次 slot。

### Task 2.2：先以 deterministic deferred promises 測排程

**Tests:**

1. 同一個 `createRoutingLane()` template 可用三組 fake adapter 建立 OpenRouteService、Transitous、TDX lane，不存在 provider-specific worker loop。
2. OpenRouteService、Transitous、TDX 三條線可同時啟動。
3. 每條線內永遠只有一個 active job，依時間排序。
4. 某線 pending automatic A/B 時，manual M 插在 active job 後、A/B 前。
5. manual 插隊不會取消已送出的 API request。
6. 一線卡住不阻塞另兩線。
7. 三線失敗都產生 `review-enqueued`，不是直接完成。
8. 同一 review item 改 mode 後可重新分類到不同 provider lane。
9. abort 會停止 pending jobs 且不留下未處理 promise。
10. `prepareTimelineLegs()` 在 job 建立前恰好呼叫一次。

Run RED:

```powershell
npm.cmd test -- src/lib/timeline/route-scheduler.test.ts src/lib/timeline/process-timeline.test.ts
```

Implement one minimal priority deque/worker template and instantiate it three times. Then rerun GREEN and commit:

```powershell
git add src/lib/timeline src/lib/routing/provider-adapter.ts src/lib/server/request-rate-limiter.ts src/lib/server/rate-limited-fetch.ts src/lib/server/rate-limited-fetch.test.ts
git commit -m "feat: add reusable timeline routing lanes"
```

### Task 2.3：落實 provider 頻率規則

**Files:**

- Move: `src/lib/providers/tdx/rate-limiter.ts` → `src/lib/server/sliding-window-rate-limiter.ts`
- Move: `src/lib/providers/tdx/rate-limiter.test.ts` → `src/lib/server/sliding-window-rate-limiter.test.ts`
- Create: `src/lib/timeline/route-scheduler-rate-limit.test.ts`
- Modify: `src/lib/server/rate-limited-fetch.ts`
- Modify: `src/lib/server/rate-limited-fetch.test.ts`
- Modify: `src/lib/providers/tdx/client.ts`
- Modify: `src/lib/providers/tdx/client.test.ts`
- Modify: `src/lib/providers/openrouteservice/client.ts`
- Modify: `src/lib/providers/openrouteservice/client.test.ts`
- Modify: `src/lib/providers/transitous/client.ts`
- Modify: `src/lib/providers/transitous/client.test.ts`
- Modify: `src/lib/server/env.ts`
- Modify: `src/lib/server/env.test.ts`
- Modify: `src/app/api/routes/repair/route.ts`
- Modify: `src/app/api/routes/repair/route.test.ts`
- Modify: `.env.example`

**Tests and behavior:**

- 三家 provider 共用同一個 `RequestRateLimiter` interface、`createSlidingWindowRateLimiter()` implementation 與 `createRateLimitedFetch()` template；差異只來自 limiter 設定與哪些 endpoint 使用 wrapped fetch。
- OpenRouteService Directions：`{ limit: 40, windowMilliseconds: 60_000 }`；前 40 次立即取得 slot，第 41 次等待滾動視窗；retry 也取得新 slot；reverse geocode 不占 Directions slot。
- TDX MaaS：`{ limit: configuredTdxLimit, windowMilliseconds: 60_000 }`；每次 MaaS attempt 都取得 slot；OAuth token 使用 raw fetch，不占 MaaS slot；預設 5/60s，可由合法正整數環境值覆寫。
- TDX 的 automatic、manual 與 retry request 必須共用同一個 production limiter 與同一組滾動視窗紀錄；人工插隊只改 queue 順序，不能重設、複製或繞過 limiter。
- Transitous scheduler 證明同時間只有一筆 routing。
- Transitous client 使用共用、可注入的 `RequestRateLimiter`；預設 `{ limit: 1, windowMilliseconds: 5_000 }`，所以第一個 attempt 可立即執行，後續每個 attempt 至少相隔 5 秒。
- `fetchWithRetry` 的每個實際 HTTP attempt 都必須重新 `acquire()`；不能只限制最外層 route job。
- 429 測試必須同時證明先遵守 `Retry-After`，重試送出前仍取得 5 秒 limiter slot。
- 等待 Transitous slot 時收到 abort，必須取消等待且不得送出 fetch。
- 不同 `createTransitousClient()` instance 必須共享同一個 production limiter，避免 Next.js 每個 `/api/routes/repair` request 重新建立後失去跨請求間隔。
- 新增 `TRANSITOUS_MIN_INTERVAL_MS=5000`。`readServerEnv()` 只接受 `1000..60000` 的整數毫秒；空值使用 5,000。API handler 將解析值交給 Transitous client 的 shared-limiter registry。環境變數是本專案操作設定，不是官方配額。
- 所有限流器在 module/process scope 共用；README 提醒多實例部署需共享限流。

三家 client 都遵循相同注入形狀；以下為 Transitous 的具體型別：

```ts
interface TransitousClientOptions {
  contactUrl: string | undefined;
  fetchFn?: typeof fetch;
  now?: () => Date;
  minimumIntervalMilliseconds?: number;
  requestLimiter?: RequestRateLimiter;
}
```

正式 client 預設從 `sharedTransitousLimiterFor(minimumIntervalMilliseconds)` 取得 module-scope limiter；OpenRouteService 與 TDX 也使用各自 module-scope shared limiter。單元測試一律注入 fake limiter 與 fake clock，不打 live API。

新增 `route-scheduler-rate-limit.test.ts`，使用實際 `createSlidingWindowRateLimiter()`、fake clock／timers 與 deferred fetch，固定以下 TDX 整合情境：

1. 同一個 shared TDX limiter 在目前滾動 60 秒內已記錄 4 次 automatic HTTP attempts；第 4 次 request 保持 active，以 deferred response 暫停 lane。
2. active request 尚未完成時，TDX lane 已有 automatic A、B 等待；使用者再送入 manual M，M 排到 A、B 前面。
3. 解除第 4 次 request 的 deferred response 後，M 取得第 5 個 slot 並送出，視窗計數成為 5/60s；不能為 manual job 建立新 limiter。
4. M 完成後輪到 A，但在最舊 slot 滾出 60 秒視窗前，fetch 呼叫數必須維持 5，A 不得立即送出。
5. fake clock 推進到最舊 slot 可釋放的邊界後，A 才取得下一個 slot；此時新的滾動視窗仍不得超過 5 次。
6. 測試同時斷言 M 的確比 A、B 先執行，證明「最高優先權」與「相同頻率限制」兩個條件同時成立。

Run:

```powershell
npm.cmd test -- src/lib/server/sliding-window-rate-limiter.test.ts src/lib/timeline/route-scheduler-rate-limit.test.ts src/lib/providers/openrouteservice/client.test.ts src/lib/providers/tdx/client.test.ts src/lib/providers/transitous/client.test.ts src/lib/server/fetch-with-retry.test.ts src/lib/server/env.test.ts src/app/api/routes/repair/route.test.ts
```

Commit:

```powershell
git add .env.example src/lib/server src/lib/providers src/lib/timeline/route-scheduler-rate-limit.test.ts src/app/api/routes/repair
git commit -m "feat: enforce provider routing limits"
```

### Task 2.4：把現有處理流程接到 session

**Files:**

- Modify: `src/lib/timeline/process-timeline.ts`
- Modify: `src/lib/timeline/process-timeline.test.ts`
- Modify: `src/lib/timeline/prepare-timeline-legs.ts`
- Modify: `src/app/timeline/page.tsx`
- Modify: `src/app/timeline/page.test.tsx`
- Modify: `src/lib/domain/types.ts`
- Modify: `src/lib/domain/provenance.ts`
- Modify: `src/lib/domain/provenance.test.ts`
- Modify: `src/lib/routing/mode-policy.ts`
- Create: `src/lib/routing/mode-policy.test.ts`
- Modify: `src/lib/routing/repair-route.ts`
- Modify: `src/lib/routing/repair-route.test.ts`
- Create: `src/lib/routing/repair-request-schema.ts`
- Create: `src/lib/routing/repair-request-schema.test.ts`
- Create: `src/lib/providers/openrouteservice/mode-map.ts`
- Create: `src/lib/providers/openrouteservice/mode-map.test.ts`
- Create: `src/lib/providers/tdx/mode-map.ts`
- Create: `src/lib/providers/tdx/mode-map.test.ts`
- Create: `src/lib/providers/transitous/mode-map.ts`
- Create: `src/lib/providers/transitous/mode-map.test.ts`
- Modify: `src/app/api/routes/repair/route.ts`
- Modify: `src/app/api/routes/repair/route.test.ts`

保留 `processTimeline()` 作為等待 `session.automaticDone` 的相容 wrapper，平行任務窗 A 再把 UI 切到 events + `session.finished`。移除現在的 `"regular" | "tdx"` 分類與兩組 `runLane()`；所有 initial repair 與 merged retry 都必須走 scheduler，不能從旁繞過 provider limiter 或 priority queue。

在建立 jobs 前呼叫 identity `prepareTimelineLegs()`。把 provider mode constant 從 client 拆到各自的 `mode-map.ts` 並於 framework commit 凍結；平行任務窗 A 只用穩定 mapping 建立 review catalog，不碰 provider client／limiter，平行任務窗 B 只修改 `prepare-timeline-legs.ts` 與 coalescing 檔案。

在 framework commit 一次完成並凍結：

- `TransportMode` 的一般模式、TDX 精確模式與 MOTIS v6 非飛行 transit modes。
- exhaustive `modeFamily(mode)`：每個穩定 mode 恰好分類為 `"general"`、`"public-transit"` 或 `"flight"`；OpenRouteService 的步行、跑步、自行車、機車與開車都屬於 `"general"`。
- neutral provenance labels；國內外選項與文案由任務窗 A 依 catalog 組成，不在核心框架為個別交通方式加入顯示邏輯。
- `routePolicy()` 的台灣／國外 provider 分派。
- OpenRouteService profile、TDX transit code、Transitous MOTIS enum 的 exhaustive mode maps。
- 共用 `repairRequestSchema`；API route 只 import schema，不再內嵌 `z.enum()`。
- 廣義 `train` 與現有 IndexedDB/cache key 相容性。

Run the vocabulary/mapping tests:

```powershell
npm.cmd test -- src/lib/domain/provenance.test.ts src/lib/routing/mode-policy.test.ts src/lib/routing/repair-route.test.ts src/lib/routing/repair-request-schema.test.ts src/lib/providers/openrouteservice/mode-map.test.ts src/lib/providers/tdx/mode-map.test.ts src/lib/providers/transitous/mode-map.test.ts src/app/api/routes/repair/route.test.ts
```

Expected: 每個穩定 mode 恰好屬於一個 mode family 並映射到一個正確 provider request；沒有 unsafe type cast 隱藏未處理 mode。

核心框架交付時，現有 page 可以仍等待相容 wrapper 才一次顯示人工審查；這是刻意的中間狀態。failure event、`submitReview()` 與 priority queue 必須已可用並有單元測試，真正的即時 UI 由平行任務窗 A 完成。

### Task 2.5：文件與交接

**Files:**

- Modify: `README.md`
- Modify: `src/app/data-sources/page.tsx`
- Modify: `src/app/data-sources/page.test.tsx`

README 必須明載：

- OpenRouteService 40/60s 由程式限制；2,000/24h 只備註，不實作日額度。
- TDX 預設與可設定頻率，官方實際方案為準。
- Transitous 沒有公開數字限制；5 秒最小間隔／約 12 attempts per minute 是本專案禮貌性保守值，不是官方額度。
- Transitous 工具採單線逐筆、每個 retry 重新限速、遵守 `Retry-After`、具聯絡資訊 `User-Agent`。
- `TRANSITOUS_MIN_INTERVAL_MS` 預設、合法範圍與多實例限制。
- 偶發批次建議約 10～20 筆；超過 20 筆、重複匯入或多人部署時先聯絡 Transitous。這是操作建議，不在程式硬擋 batch。
- 四線資料流與人工優先規則。

Run the framework gate:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
git diff --check
git status --short --branch
```

Expected: 全部成功；現有 UI 行為可以仍在 automatic processing 完成後一次顯示 review，但三條 lane、failure event、manual priority requeue、`automaticDone`／`finished` 與三家 limiter 必須已有 deterministic tests。

建立 framework commit、記錄 SHA。只有這個 commit 通過後，才可以**同時**建立平行任務窗 A 與 B；兩窗 prompt 都要附上相同 SHA、各自檔案所有權與「不得自行整合另一任務」的約束。

## 平行任務窗 A（接續第 3 點）：人工審查即時顯示、插隊、成功通知

### Task 3.1：事件式累加 review queue

**Files:**

- Modify: `src/app/timeline/page.tsx`
- Modify: `src/app/timeline/page.test.tsx`
- Modify: `src/components/timeline/unresolved-review.tsx`
- Modify: `src/components/timeline/unresolved-review.test.tsx`

Page 啟動 `TimelineProcessingSession` 後立即訂閱事件，不再呼叫相容 `processTimeline()` wrapper；background workflow 等待 `session.finished`：

- `review-enqueued`：以 gap ID 去重並 append 到尾端，不重排既有人工操作項目。
- UI 在 `processing === true` 時也顯示。
- `review-removed`：只移除已成功或明確排除的項目。
- 新 failure 發生時不能重置目前使用者正在選擇的 mode。

### Task 3.2：人工回答回送最高優先權

`UnresolvedReview` 不再直接呼叫 `requestRepair()`；改呼叫 session `submitReview()`：

1. 根據人工 mode 與端點重新決定 OpenRouteService／Transitous／TDX lane。
2. 以 `manual` priority 插到該 lane pending queue 最前面。
3. 仍使用該 provider 與 automatic jobs 共用的 limiter；插隊只改 pending queue 順序，不能繞過限流或清除既有 request timestamps。
4. 成功後才寫入 correction store 與 route cache。
5. 失敗時保留目前卡片並顯示錯誤。
6. 「此路段不存在」直接儲存 exclusion 並移除。
7. 「暫時略過」只切到下一張，不標記完成。

### Task 3.3：成功通知後跳下一段

**Files:**

- Modify: `src/components/timeline/unresolved-card.tsx`
- Modify: `src/components/timeline/unresolved-review.tsx`
- Modify: `src/app/globals.css`

新增 accessible live status：

```text
路段查詢成功，已加入輸出路線。
```

事件順序固定為：provider 成功 → cache/correction 寫入成功 → 顯示成功通知 → 移除目前卡片 → 顯示下一段。測試使用 fake/deferred promises 證明通知不會在 provider 或 IndexedDB 寫入前出現。

### Task 3.4：finalization、進度與取消

只有以下條件同時成立才建立 GPX：

1. 三條 automatic lane 都 idle。
2. 沒有 active manual repair。
3. review queue 為空。

進度的 `total` 固定為分派後 job 數；只有成功修復或使用者排除才增加 `current`。進入人工審查不算完成。取消會中止三線 active/pending job、拒絕後續人工 submit，並保留已完成結果供報告但不建立不完整 GPX。

### Task 3.5：整合／E2E 測試

**Files:**

- Modify: `e2e/timeline.spec.ts`
- Add or modify synthetic fixture only if necessary under `src/test/fixtures/timeline/`

E2E 用延遲 route interception 證明：

1. 第一個 provider failure 一發生，人工卡片立即出現，另一 provider 尚未完成。
2. 後續 failure 一筆一筆 append。
3. 任一人工交通方式修正會排在同 lane 的下一個 automatic request之前，但仍等待共用 limiter slot。
4. 成功通知出現後才切下一段。
5. 所有 automatic + manual 項目完成才出現下載。

不得使用真實 Timeline、真實座標或 live provider。

完成 `npm test`、lint、typecheck、build、E2E、`git diff --check`，建立任務窗 A 交接 commit並回報 SHA。不要等待或整合任務窗 B；由目前任務窗統一處理。

## 平行任務窗 B（第 4 點）：分派前合併三分鐘內相鄰且交通方式相同的大眾運輸路段

### Task 4.1：先用範例固定純函式規則

**Files:**

- Create: `src/lib/timeline/coalesce-adjacent-transit-legs.ts`
- Create: `src/lib/timeline/coalesce-adjacent-transit-legs.test.ts`
- Modify: `src/lib/timeline/prepare-timeline-legs.ts`
- Create: `src/lib/timeline/prepare-timeline-legs.test.ts`

本計畫採以下可確認規則：

- 時間差計算為 `next.startTime - current.endTime`。
- 必須嚴格 `< 180_000ms`；剛好 3 分鐘不合併。
- 只比較交通方式相同與時間差；**完全不比較** `current.endPoint` 與 `next.startPoint`。
- 只有 `modeFamily(mode) === "public-transit"` 才進入合併判斷；所有大眾運輸模式一律適用，不另外排除公車、公路客運、輕軌、渡輪、登山纜車、空中纜車或其他 TDX／MOTIS 大眾運輸。
- `modeFamily(mode) === "general"` 的步行、跑步、自行車、機車、開車，以及獨立飛行流程，都不合併並維持原本路段。
- 每合併一次，用累積結果繼續和下一段比較，直到時間或 mode 任一不符。

核心範例：

```text
08:00 A → 08:10 B，火車
08:11 X → 08:30 C，火車
```

即使 `B !== X`，仍輸出一個：

```text
08:00 A → 08:30 C，火車
```

除了上述兩段案例，`coalesce-adjacent-transit-legs.test.ts` 必須明確加入下列連鎖合併測試；每個案例都斷言輸出陣列只有一段、起點／開始時間取第一段、終點／結束時間取最後一段，且中間端點即使完全不同也不影響結果：

1. 三段相同大眾運輸：

   ```text
   08:00 A → 08:10 B
   08:11 X → 08:20 C
   08:22 Y → 08:30 D
   ```

   預期輸出：`08:00 A → 08:30 D`。

2. 四段相同大眾運輸：

   ```text
   08:00 A → 08:10 B
   08:11 X → 08:20 C
   08:22 Y → 08:30 D
   08:32 Z → 08:45 E
   ```

   預期輸出：`08:00 A → 08:45 E`。這個案例必須證明每次合併後，實作會繼續以累積結果和下一段比較，而不是只合併第一對路段。

另外測試 chain 中途遇到不同 mode 或剛好 3:00 時會在該處斷開，不會錯誤吞掉後面的路段；並涵蓋 2:59、負時間／重疊資料與中間點漂到完全不同座標。另以 exhaustive table-driven cases 固定類別邊界：

1. 每個 `modeFamily() === "public-transit"` 的穩定模式，在 mode 相同且間隔 2:59 時都會合併，包含公車、渡輪與各類纜車。
2. 每個 `modeFamily() === "general"` 的 OpenRouteService 模式，即使 mode 相同且間隔 2:59 也維持兩段，不合併。
3. 合併函式只依共用 `modeFamily()`，不得再維護一份容易漏掉新大眾運輸模式的 whitelist／blacklist。

### Task 4.2：實作合併結果

合併 group 產生一個 deterministic leg/job：

- start point/time 取第一段。
- end point/time 取最後一段。
- 中間 endpoints 與 intermediate repair gaps 不保留為 routing waypoint。
- 重新計算 distance 與 elapsed time。
- ID 同時包含第一、最後原始 ID，避免與未合併 correction/cache key 碰撞。
- recorded runs、report item 與 provenance 不可重複輸出。

如果需要變更 correction key 語義，將 `TIMELINE_SCHEMA_VERSION` 與 `ROUTE_ALGORITHM_VERSION` 升版，讓舊 IndexedDB 修正不會誤套到新合併 job。

### Task 4.3：接在最初分派之前

**Files:**

- Modify: `src/lib/timeline/prepare-timeline-legs.ts`
- Modify: `src/lib/timeline/prepare-timeline-legs.test.ts`
- Modify: `src/lib/timeline/process-timeline.test.ts`

執行順序：

```text
buildTimelineLegs
→ coalesceAdjacentTransitLegs
→ 建立 routing jobs
→ 依合併後起終點與 mode 分到 ORS / Transitous / TDX
→ 三線處理
→ failure 進人工線
```

加入整合測試：台灣大眾運輸案例最終只呼叫一次 TDX，海外大眾運輸案例只呼叫一次 Transitous，兩者的 request 都使用合併後第一段起點與最後一段終點。其中至少一個 provider 整合案例使用上述四段 chain，確認前處理後只建立一個 routing job。相同時間條件的一般步行或開車案例維持兩段，分別呼叫 OpenRouteService，不得合併成一個 A→C request。

不得修改 `src/lib/timeline/route-scheduler.ts`、`src/lib/timeline/routing-lane.ts` 或 `src/app/timeline/page.tsx`。若預留 seam 不足，停止並回報目前任務窗，不自行擴大檔案範圍。

### Task 4.4：任務窗 B 驗證與交接

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
git diff --check
git status --short --branch
```

任務窗 B 人工檢查：

- 中間點完全不參與三分鐘合併判斷。
- 沒有真實座標、憑證、Timeline 或 provider response body 進入 Git。

建立任務窗 B 交接 commit並回報 SHA。不要等待或整合任務窗 A；由目前任務窗統一處理。

## 目前任務窗：平行成果整合與最終驗證

等待 A、B 都完成後：

1. 讀取兩個任務的完成訊息、commit SHA、測試輸出與未解決事項。
2. 先整合任務窗 B 的純前處理 commit，再整合任務窗 A 的人工審查 commit；若實際 diff 顯示相反順序衝突更少，可以調整，但要記錄理由。
3. 衝突只在目前任務窗解決；不得讓 A、B 互相 cherry-pick。
4. 檢查 `prepareTimelineLegs()` 確實在 lane 分派前執行，人工 correction 使用合併後 deterministic ID。
5. 執行下列完整驗證。

Run:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
git diff --check
git status --short --branch
git log --oneline -12
```

最後人工檢查：

- 三條線都由相同 `RoutingLane` template 建立，沒有 provider-specific worker loop。
- 四條線與最高優先權規則仍通過 deterministic tests。
- 所有 provider retry 都透過 `createRateLimitedFetch()` 計入相應 limiter。
- OpenRouteService、TDX、Transitous 分別使用 40/60s、設定值/60s、1/5s 的共用 limiter interface。
- TDX 的 4 次既有 requests 加上插隊 manual request 後為 5/60s，後續 automatic request 會等待最舊 slot 釋放。
- Transitous 文件沒有把 5 秒禮貌性間隔誤寫成官方限制。
- Transitous automatic、manual 與 retry attempts 都共用相同的 production limiter。
- review queue 在 background processing 中即時 append。
- 中間點完全不參與三分鐘合併判斷。
- 所有大眾運輸模式都適用三分鐘合併，所有 OpenRouteService 一般模式都不合併。
- GPX 只在全部 automatic/manual 決策完成後建立。
- 沒有真實座標、憑證、Timeline 或 provider response body 進入 Git。

建立最後本機整合 commit並回報結果；除非使用者另外要求，不 push、不開 PR。

## 已確認的合併邊界

1. 「時間差 < 3 分鐘」採嚴格小於；剛好 3:00 不合併。
2. 合併規則適用所有相同的大眾運輸 `TransportMode`，包含公車、渡輪與纜車等，不設例外。
3. 步行、跑步、自行車、機車、開車等 OpenRouteService 一般模式不合併。
