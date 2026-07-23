import Link from "next/link";

import { HomeChoiceCard } from "@/components/home-choice-card";

export default function Home() {
  return (
    <main className="page-shell">
      <section className="hero-panel" aria-labelledby="home-title">
        <p className="eyebrow">Local-first GPX 工具</p>
        <h1 id="home-title">
          把你的旅程帶進
          <span>Fog of World</span>
        </h1>
        <p className="hero-copy">
          選擇資料類型。原始時間軸留在瀏覽器內，產生的路線會清楚標示來源與近似狀態。
        </p>
        <div className="choice-grid">
          <HomeChoiceCard
            href="/flight"
            title="航班"
            description="確認一個或多個航班，依可用來源還原路線並匯出 GPX。"
            icon="航"
          />
          <HomeChoiceCard
            href="/timeline"
            title="時間軸"
            description="在本機解析 Google 匯出資料，修補稀疏路段並保留來源紀錄。"
            icon="軸"
          />
        </div>
        <p className="privacy-note">
          <span aria-hidden="true">◉</span>
          不含地圖、分析追蹤或原始檔上傳。
          <Link href="/data-sources">資料來源</Link>
        </p>
      </section>
    </main>
  );
}
