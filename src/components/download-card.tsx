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
  return (
    <section className="panel">
      <h2>GPX 已準備完成</h2>
      <p>
        {filename} · {(size / 1024).toFixed(1)} KB
      </p>
      {warning ? <p role="status">{warning}</p> : null}
      <a href={url} download={filename}>
        下載 GPX
      </a>
    </section>
  );
}
