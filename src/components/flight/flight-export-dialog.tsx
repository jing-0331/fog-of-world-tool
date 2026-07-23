interface FlightExportDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FlightExportDialog({
  open,
  onCancel,
  onConfirm,
}: FlightExportDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
      >
        <h2 id="export-title">航班資訊是否無誤？</h2>
        <p>確認後會依清單順序尋找路線並產生一個 GPX 檔。</p>
        <div className="button-row">
          <button type="button" onClick={onCancel}>
            返回檢查
          </button>
          <button className="primary-button" type="button" onClick={onConfirm}>
            確認並開始匯出
          </button>
        </div>
      </section>
    </div>
  );
}
