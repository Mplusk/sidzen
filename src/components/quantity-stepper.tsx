"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Keep edits local until blur or Enter; the server remains the source of truth. */
export function QuantityStepper({ name, quantity, max, disabled = false, pending = false, onChange, className, errorClassName }: {
  name: string; quantity: number; max: number; disabled?: boolean; pending?: boolean;
  onChange: (quantity: number) => void; className: string; errorClassName?: string;
}) {
  const [draft, setDraft] = useState({ quantity, value: String(quantity) });
  const [error, setError] = useState<{ quantity: number; max: number; message: string } | null>(null);
  const skipBlur = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const value = draft.quantity === quantity ? draft.value : String(quantity);
  const message = error?.quantity === quantity && error.max === max ? error.message : "";
  const blocked = disabled || pending || max < 1;
  useEffect(() => { input.current?.setCustomValidity(""); }, [quantity, max, disabled]);

  function commit(text: string) {
    if (blocked) return;
    const next = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(next) || next < 1 || next > max) {
      const message = `Введите целое число от 1 до ${max}.`;
      input.current?.setCustomValidity(message);
      setError({ quantity, max, message });
      return;
    }
    input.current?.setCustomValidity("");
    setDraft({ quantity, value: String(quantity) });
    setError(null);
    if (next !== quantity) onChange(next);
  }
  function step(delta: number) {
    skipBlur.current = false;
    const entered = /^\d+$/.test(value) ? Number(value) : quantity;
    const base = Number.isSafeInteger(entered) && entered >= 1 && entered <= max ? entered : quantity;
    commit(String(Math.max(1, Math.min(max, base + delta))));
  }
  return <>
    <div className={className} role="group" aria-label={`Количество: ${name}`} aria-busy={pending}>
      <button type="button" aria-label={`Уменьшить количество: ${name}`} disabled={blocked || quantity <= 1} onPointerDown={() => { skipBlur.current = document.activeElement === input.current; }} onPointerUp={() => { skipBlur.current = false; }} onPointerCancel={() => { skipBlur.current = false; }} onPointerLeave={() => { skipBlur.current = false; }} onClick={() => step(-1)}>−</button>
      <input ref={input} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} aria-label={`Количество товара: ${name}`} aria-invalid={!!message} aria-describedby={message ? errorId : undefined} value={value} disabled={blocked} required
        onChange={event => { event.currentTarget.setCustomValidity(""); setDraft({ quantity, value: event.target.value }); setError(null); }}
        onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commit(value); }}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { event.preventDefault(); skipBlur.current = true; event.currentTarget.setCustomValidity(""); setDraft({ quantity, value: String(quantity) }); setError(null); event.currentTarget.blur(); }
        }} />
      <button type="button" aria-label={`Увеличить количество: ${name}`} disabled={blocked || quantity >= max} onPointerDown={() => { skipBlur.current = document.activeElement === input.current; }} onPointerUp={() => { skipBlur.current = false; }} onPointerCancel={() => { skipBlur.current = false; }} onPointerLeave={() => { skipBlur.current = false; }} onClick={() => step(1)}>+</button>
    </div>
    {message && <p id={errorId} className={errorClassName} role="alert">{message}</p>}
  </>;
}
