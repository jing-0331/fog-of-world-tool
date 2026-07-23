export default function DataSourcesPage() {
  return (
    <main className="page-shell">
      <article className="panel">
        <p className="eyebrow">透明度</p>
        <h1>資料來源</h1>
        <p>
          每條路線都會分別標示路線種類、資料提供者、參考日期與是否為近似結果。
        </p>
        <ul>
          <li>航班資料：AeroDataBox、OpenSky、Flight Plan Database</li>
          <li>地面路線：OpenRouteService 與 OpenStreetMap</li>
          <li>大眾運輸：Transitous 當前網路資料</li>
          <li>時間軸輸入：只在你的瀏覽器中解析</li>
        </ul>
      </article>
    </main>
  );
}
