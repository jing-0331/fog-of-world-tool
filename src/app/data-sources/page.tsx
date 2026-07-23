const sources = [
  {
    name: "AeroDataBox",
    href: "https://doc.aerodatabox.com/",
    description: "航班時刻、機場與航班識別資料；使用方式依服務方案而定。",
  },
  {
    name: "OpenSky",
    href: "https://opensky-network.org/data/api",
    description:
      "飛行軌跡資料；API 與資料使用受 OpenSky 使用條款及授權限制約束。",
  },
  {
    name: "Flight Plan Database",
    href: "https://flightplandatabase.com/dev/api",
    description:
      "提供申報或模擬航路；其資料僅供飛行模擬，不得用於真實世界導航。",
  },
  {
    name: "OpenRouteService",
    href: "https://openrouteservice.org/dev/",
    description:
      "地面路線修復。© openrouteservice.org by HeiGIT；路圖資料 © OpenStreetMap contributors。",
  },
  {
    name: "OpenStreetMap",
    href: "https://www.openstreetmap.org/copyright",
    description: "OpenRouteService 使用的開放地圖資料；須遵守 ODbL 與署名要求。",
  },
  {
    name: "TDX",
    href: "https://tdx.transportdata.tw/api-service/swagger/maas/4513f9d6-caae-4cf7-a50c-e7887bec804e",
    description:
      "交通部運輸資料流通服務；用於台灣境內的大眾運輸路線規劃，需以會員 API 金鑰存取。免付費方案每分鐘最多 5 次請求，本工具會將 MaaS 請求與自動重試排入共用佇列。",
  },
  {
    name: "Transitous",
    href: "https://transitous.org/api/",
    description:
      "以 best-effort 方式提供目前可用的大眾運輸路網；公開服務以自由／開源、非營利用途為主，大量使用前請聯絡營運者。",
  },
  {
    name: "Google Timeline 匯出說明",
    href: "https://support.google.com/maps/answer/6258979",
    description: "本工具接受使用者自行匯出的 Timeline JSON，Google 不參與本工具。",
  },
] as const;

export default function DataSourcesPage() {
  return (
    <main className="page-shell">
      <article className="panel grid gap-8">
        <header>
          <p className="eyebrow">透明度</p>
          <h1>資料來源與使用限制</h1>
          <p className="mt-3 max-w-3xl text-slate-700">
            每條結果都會標示實際軌跡、申報航路、模擬航路與近似路線等種類，
            並附資料來源、參考日期及是否為近似結果。近似路線不等於使用者實際走過的軌跡。
          </p>
        </header>

        <section aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">Timeline 隱私</h2>
          <p className="mt-2 text-slate-700">
            原始 Timeline JSON 不會離開瀏覽器，也不會送往本工具的伺服器或第三方。
            只有需要補路的匿名端點與交通模式會經同源 API 送往路線服務；本專案不含地圖、
            分析追蹤或遙測。
          </p>
        </section>

        <section aria-labelledby="limitations-heading">
          <h2 id="limitations-heading">重要限制</h2>
          <ul className="mt-3 grid list-disc gap-2 pl-6 text-slate-700">
            <li>
              歷史大眾運輸路線使用目前可用的路網重建，可能與當時實際班次或路線不同。
            </li>
            <li>
              航班軌跡及申報航路依資料可用性逐級降級；大圓路線永遠標示為近似。
            </li>
            <li>
              無法可靠修復的缺口會進入人工審核，不會自動以直線偽裝成實際軌跡。
            </li>
          </ul>
        </section>

        <section aria-labelledby="sources-heading">
          <h2 id="sources-heading">來源、署名與使用條件</h2>
          <ul className="mt-3 grid gap-4">
            {sources.map((source) => (
              <li key={source.name}>
                <a
                  className="font-semibold text-cyan-800 underline decoration-cyan-300 underline-offset-4"
                  href={source.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.name}
                </a>
                <p className="mt-1 text-slate-700">{source.description}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate-600">
            OpenRouteService 回傳結果依 CC BY 4.0 使用。TDX 資料依其資料授權條款使用；
            Transitous 請求會帶上應用程式版本與聯絡網址，資料來源依各 feed 的授權與署名要求為準。
          </p>
        </section>
      </article>
    </main>
  );
}
