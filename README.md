# Fog of World GPX Tool

一個 local-first 的繁體中文網頁工具，把已確認的航班與 Google Timeline 匯出資料整理成可供 Fog of World 等 GPX 閱讀器使用的軌跡。

工具會清楚區分「實際軌跡」、「申報航路」、「模擬航路」與「近似路線」，並把資料來源、參考日期、近似狀態及人工修正寫入畫面與 GPX。無法可靠修復的缺口會進入人工審核，不會用直線冒充實際行程。

## 本機安裝

需求：

- Node.js 24
- npm
- Playwright Chromium（只在執行端到端測試時需要）

```bash
npm ci
cp .env.example .env.local
npm run dev
```

開啟 <http://localhost:3000>。Windows PowerShell 可使用：

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
npm.cmd run dev
```

正式模式：

```powershell
npm.cmd run build
npm.cmd start
```

## Provider 設定

將 `.env.example` 複製為 `.env.local`，只填入需要的服務。所有密鑰只由 Next.js server route 讀取；不要使用 `NEXT_PUBLIC_` 前綴，也不要提交 `.env.local`。

| 環境變數 | 啟用能力 | 未設定時 |
| --- | --- | --- |
| `AERODATABOX_RAPIDAPI_KEY` | 航班／機場搜尋；超過 100 天航班的近期同航線代表班次 | 無法搜尋與找代表班次 |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | 已抵達且不超過 30 天、並有 ICAO24 的實際飛行軌跡 | 繼續嘗試申報、模擬或大圓路線 |
| `FLIGHTPLANDB_API_KEY` | Flight Plan Database 的完整模擬航路查詢 | 仍可嘗試不需憑證的查詢，最後可本機計算大圓路線 |
| `OPENROUTESERVICE_API_KEY` | Timeline 地面路線修復與反向地理編碼 | 地面缺口進入人工審核 |
| `TDX_CLIENT_ID` + `TDX_CLIENT_SECRET` | 起訖點都在台灣的大眾運輸路線修復 | 台灣大眾運輸缺口進入人工審核 |
| `TRANSITOUS_CONTACT_URL` | 台灣以外且 Transitous 有公開 feed 地區的大眾運輸路線修復；必須是可聯絡的真實網址 | 海外大眾運輸缺口進入人工審核 |

範例：

```dotenv
AERODATABOX_RAPIDAPI_KEY=
OPENROUTESERVICE_API_KEY=
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
FLIGHTPLANDB_API_KEY=
TDX_CLIENT_ID=
TDX_CLIENT_SECRET=
TRANSITOUS_CONTACT_URL=https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY
```

畫面會顯示各能力是否可用，而不會回傳密鑰。TDX 憑證可在 TDX 會員中心的「資料服務 → API 金鑰」取得；兩個欄位必須一起設定。為符合 TDX 免付費方案每分鐘最多 5 次請求的限制，同一個 server process 會將所有 MaaS 路線請求排入共用的滾動 60 秒佇列，自動重試也會計入；OAuth token 請求不計入 MaaS 額度。多實例部署須另以共享限流服務協調全域額度。`TRANSITOUS_CONTACT_URL` 不能保留範例值；工具會把應用程式名稱、版本與聯絡網址放在 Transitous 的 `User-Agent`。若要大量路線查詢，請先聯絡 Transitous 營運者。

## 航班工作流

1. 輸入航班號與出發日期，從候選班次中明確確認。
2. 可連續加入多個航班，再一次產生 `FlightRouteYYMMDD.gpx`。
3. 路線依可用資料逐級嘗試：OpenSky 實際軌跡 → 申報航路 → Flight Plan Database 模擬航路 → 本機大圓近似。

時間規則：

- 已抵達、不超過 30 天且有 ICAO24 的航班才嘗試 OpenSky 歷史軌跡。
- 超過 100 天的已抵達航班，會先在最近 100 天內尋找相同航班號與起訖機場的代表班次；畫面及 GPX 使用該代表班次的參考日期。
- 31–100 天或沒有合適代表班次時，跳過 OpenSky，繼續使用其餘來源。

資料不足時產生的大圓路線只是地理近似；Flight Plan Database 資料僅供飛行模擬，兩者都不是實際飛行軌跡，也不得用於真實世界導航。

## Timeline 工作流與隱私

1. 在 Google Maps／Timeline 支援頁面所述的裝置匯出功能取得 JSON。
2. 把 `.json` 拖入或選入瀏覽器；檔案由 Web Worker 串流解析。
3. 選擇完整期間或自訂含首尾日期的區間。
4. 自動修復後，對未解決項目選擇更正交通模式、刻意排除或暫後處理。
5. 驗證通過後下載 `TimelineRouteYYMMDD.gpx`。

隱私邊界：

- 原始 Timeline JSON、Wi-Fi 掃描、使用者 profile 欄位及完整檔案內容不會 POST 到本工具 server 或任何 provider。
- 原始檔不會寫入 server 檔案系統；解析與日期篩選在瀏覽器內完成。
- 只有需要補路的起點、終點、時間與交通模式會送到同源 `/api/routes/repair`，再由 server adapter 呼叫 OpenRouteService、TDX 或 Transitous。這些 provider 需要端點座標才能計算路線。
- 人工修正與路線快取只存在瀏覽器 IndexedDB。
- 專案沒有地圖、分析追蹤或遙測。

本儲存庫只使用手寫、匿名、合成的 Timeline fixtures。不得把個人 Timeline 匯出檔、真實座標、私人日期區間、下載路徑或驗收輸出提交至 Git。

### 歷史大眾運輸限制

起訖點都在台灣時使用 TDX MaaS 路線規劃；其他地區使用 Transitous 目前可用的公開 feed 與路網進行 best-effort 規劃。TDX 請求受每分鐘 5 次的本機佇列限制，繁忙時單次修復可能需要等待。兩者都以查詢當下可用的路網修復歷史 Timeline，可能與旅程當時的站點、班次或走線不同，所以結果一律標為「大眾運輸近似」並附查詢參考日期。Transitous 實作使用現行 MOTIS `/api/v6/plan`；這是相對於早期設計文件 `/api/v5/plan` 的明確 API 相容性調整。

### 人工審核

- 「更正交通模式」會用新模式重新查詢，成功後把修正持久化於本機，GPX 標為 `userOverride`。
- 「刻意排除」會記錄為排除項目，不輸出該段。
- 「暫後處理」保留未解決狀態，可繼續檢視其他項目。
- 即使有未解決缺口，只要仍有有效軌跡即可下載部分結果；畫面與 GPX metadata 會一致顯示未解決、排除與跳過航班數。
- 若完全沒有可輸出路線，就不提供下載。

## GPX 輸出

輸出符合 GPX 1.1，並使用 `urn:fog-of-world-tool:extensions:v1` 擴充命名空間：

- 每條 route：`kind`、`source`、`referenceDate`、`approximate`、`userOverride`、說明及原始／更正交通模式。
- 全檔 report：`unresolvedCount`、`excludedCount`、`skippedFlightCount`。
- 每個輸出 track segment 內的相鄰點距離不超過 2 公里；補點時間會在已知首尾時間間插值。

來源標記代表資料與演算法的出處，不保證路線就是使用者真正走過或飛過的軌跡。

## 測試

所有測試只使用匿名合成資料；CI 會攔截同源 API，不呼叫 live providers。

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

macOS／Linux 可將 `npm.cmd` 與 `npx.cmd` 分別改成 `npm` 與 `npx`。

## 資料來源、授權與使用條件

- [AeroDataBox API 文件](https://doc.aerodatabox.com/)：航班、機場與航線資料；依帳戶方案及服務條款使用。
- [OpenSky Network API](https://opensky-network.org/data/api) 與 [使用條款](https://opensky-network.org/about/terms-of-use)：歷史飛行軌跡受其 API、資料授權與操作性使用限制約束；使用前請自行確認目前條款及必要許可。
- [Flight Plan Database API](https://flightplandatabase.com/dev/api)：航路資料僅供飛行模擬，不得用於真實世界導航；使用時遵守其署名與 API 條款。
- [OpenRouteService API](https://openrouteservice.org/dev/) 與 [使用條款](https://openrouteservice.org/terms-of-service/)：`© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors`；回傳結果依 CC BY 4.0 使用。
- [OpenStreetMap 著作權與授權](https://www.openstreetmap.org/copyright)：地圖資料 © OpenStreetMap contributors，依 ODbL 使用。
- [TDX 公共運輸旅運規劃 API](https://tdx.transportdata.tw/api-service/swagger/maas/4513f9d6-caae-4cf7-a50c-e7887bec804e) 與 [資料授權利用條款](https://tdx.transportdata.tw/term)：用於台灣境內的大眾運輸路線規劃；需申請會員 API 金鑰。免付費方案限制為每分鐘 5 次請求，並須遵守目前的使用與授權規範。
- [Transitous API 與使用政策](https://transitous.org/api/) 及 [feed 來源](https://transitous.org/sources/)：公開服務為 best-effort，主要供自由／開源與非營利專案；請提供可識別的 `User-Agent` 與聯絡方式，大量或重度 routing 使用前先聯絡營運者，並遵守個別 feed 的授權／署名。
- [Google Timeline 匯出說明](https://support.google.com/maps/answer/6258979)：僅作為使用者自行匯出資料的格式入口；Google 未贊助或背書本專案。

應用程式內的 `/data-sources` 頁面也列出主要來源與限制。第三方服務與條款可能變更，部署或大量使用前應重新確認。

## 授權

本專案程式碼以 [MIT License](LICENSE) 授權；第三方資料仍分別受上列來源條款約束。
