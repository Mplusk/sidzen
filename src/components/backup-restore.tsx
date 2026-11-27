"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type Backup = { name: string; modifiedAt: string; size: number };
type Restore = { id: string; status: string; phase?: string };

const progress: Record<string, string> = {
  queued: "Восстановление ожидает запуска.",
  running: "Восстанавливаем данные. Магазин временно может быть недоступен.",
  recovering: "Возвращаем данные, которые были до восстановления.",
  succeeded: "Восстановление завершено.",
  failed: "Восстановление остановлено. Данные магазина возвращены к состоянию до запуска.",
  attention: "Восстановление остановлено. Требуется проверка состояния сервера.",
};

const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
const size = (value: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} МБ`;

export function BackupRestore() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<Restore | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/backups/", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { backups: Backup[]; operation?: Restore | null; error?: string };
      if (!Array.isArray(result.backups)) throw new Error();
      setBackups(result.backups);
      setOperation(result.operation ?? null);
      setError("");
      setSelected(current => result.backups.some(backup => backup.name === current) ? current : result.backups[0]?.name ?? "");
    } catch {
      setError("Не удалось получить резервные копии. Проверьте подключение Яндекс Диска и попробуйте снова.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selectedBackup = backups.find(backup => backup.name === selected);
  const busy = !!operation && ["queued", "running", "recovering", "attention"].includes(operation.status);
  async function restore() {
    if (!selectedBackup || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const id = crypto.randomUUID();
      setOperation({ id, status: "queued" });
      const response = await fetch("/api/admin/backups/restore/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: selectedBackup.name, confirmation: "RESTORE" }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as Restore & { error?: string };
      if (result.error || !result.id || !result.status) throw new Error();
      setOperation(result);
      dialog.current?.close();
    } catch {
      setError("Ответ на запуск не получен. Проверяем состояние восстановления перед повторной попыткой.");
      dialog.current?.close();
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <p>Выберите копию, к которой нужно вернуть данные магазина. Время указано по Москве.</p>
    {error && <p className="notice notice--danger" role="alert">{error}</p>}
    {operation && <p className={`notice ${operation.status === "succeeded" ? "notice--success" : operation.status === "failed" || operation.status === "attention" ? "notice--danger" : ""}`} role="status">{operation.status === "failed" && operation.phase === "external_changes" ? "После создания копии изменились заказы, платежи, доставка или подключения. Восстановление остановлено, чтобы сохранить текущие данные." : progress[operation.status] ?? "Проверяем состояние восстановления."}</p>}
    {loading ? <p role="status">Загружаем список копий…</p> : backups.length ? <>
      <label className="field">Резервная копия
        <select value={selected} onChange={event => setSelected(event.target.value)} disabled={submitting || busy}>
          {backups.map(backup => <option key={backup.name} value={backup.name}>{date(backup.modifiedAt)} · {size(backup.size)}</option>)}
        </select>
      </label>
      <button className="button" type="button" disabled={!selectedBackup || submitting || busy} onClick={() => dialog.current?.showModal()}>Восстановить из копии</button>
    </> : !error && <p>Резервных копий на Яндекс Диске пока нет.</p>}
    <p><button className="button button--outline" type="button" onClick={() => { setLoading(true); void refresh(); }} disabled={loading || submitting}>Обновить список</button></p>
    <dialog className="confirm-dialog" ref={dialog} aria-labelledby={title} aria-describedby={description}>
      <h2 id={title}>Восстановить магазин?</h2>
      <p id={description}>Данные магазина будут заменены состоянием на {selectedBackup ? date(selectedBackup.modifiedAt) : "выбранную дату"}. Заказы, изменения товаров и другие записи, появившиеся после этой даты, будут потеряны. Во время восстановления магазин будет недоступен.</p>
      <div className="confirm-dialog__actions">
        <button autoFocus className="button button--outline" type="button" disabled={submitting} onClick={() => dialog.current?.close()}>Отмена</button>
        <button className="button button--danger" type="button" disabled={submitting} onClick={() => void restore()}>{submitting ? "Запускаем…" : "Да, восстановить"}</button>
      </div>
    </dialog>
  </>;
}
