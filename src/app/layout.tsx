import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";

import "./globals.css";

export const metadata: Metadata = {
  title: "Fog of World GPX 工具",
  description: "在本機將航班與 Google 時間軸轉換為具來源紀錄的 GPX。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body>
        <AppHeader />
        {children}
        <footer className="site-footer">
          <p>資料留在你的裝置，供你自行檢查後匯出。</p>
          <Link href="/data-sources">資料來源</Link>
        </footer>
      </body>
    </html>
  );
}
