interface ProgressPanelProps {
  title: string;
  message: string;
  current?: number;
  total?: number;
  busy?: boolean;
}

export function ProgressPanel({
  title,
  message,
  current,
  total,
  busy = true,
}: ProgressPanelProps) {
  const hasProgress = current !== undefined && total !== undefined && total > 0;

  return (
    <section className="panel" aria-live="polite" aria-busy={busy}>
      <h2>{title}</h2>
      <p>{message}</p>
      {hasProgress ? (
        <div>
          <progress value={current} max={total}>
            {current} / {total}
          </progress>
          <p>
            {current} / {total}
          </p>
        </div>
      ) : null}
    </section>
  );
}
