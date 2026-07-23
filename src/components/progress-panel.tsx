interface ProgressPanelProps {
  title: string;
  message: string;
  current?: number;
  total?: number;
}

export function ProgressPanel({
  title,
  message,
  current,
  total,
}: ProgressPanelProps) {
  const hasProgress = current !== undefined && total !== undefined && total > 0;

  return (
    <section className="panel" aria-live="polite" aria-busy="true">
      <h2>{title}</h2>
      <p>{message}</p>
      {hasProgress ? (
        <progress value={current} max={total}>
          {current} / {total}
        </progress>
      ) : null}
    </section>
  );
}
