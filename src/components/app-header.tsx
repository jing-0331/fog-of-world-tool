import Link from "next/link";

export function AppHeader() {
  return (
    <header className="app-header">
      <Link className="brand-link" href="/">
        <span className="brand-mark" aria-hidden="true">
          ◌
        </span>
        <span>Fog of World GPX</span>
      </Link>
      <nav aria-label="主要導覽">
        <Link className="header-link" href="/data-sources">
          資料來源
        </Link>
      </nav>
    </header>
  );
}
