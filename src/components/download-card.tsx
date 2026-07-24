import { useId } from "react";

interface DownloadCardProps {
  filename: string;
  url: string;
  size: number;
  warning?: string;
}

export function DownloadCard({
  filename,
  url,
  size,
  warning,
}: DownloadCardProps) {
  const titleId = useId();

  return (
    <section className="panel download-card" aria-labelledby={titleId}>
      <h2 id={titleId}>GPX 已準備完成</h2>
      <dl
        className="download-file-details"
        data-testid="download-file-details"
      >
        <div>
          <dt>檔名</dt>
          <dd>{filename}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{(size / 1024).toFixed(1)} KB</dd>
        </div>
      </dl>
      {warning ? (
        <p className="download-warning" role="status">
          {warning}
        </p>
      ) : null}
      <a
        className="download-button"
        href={url}
        download={filename}
        aria-label={`下載 GPX 檔案：${filename}`}
      >
        下載 GPX
      </a>
    </section>
  );
}
