"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDeliveryAvailability } from "@/app/actions/delivery-availability";

export function DeliveryAvailabilityToggle({ carrier, enabled }: { carrier: "ozon" | "cdek"; enabled: boolean }) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const name = carrier === "ozon" ? "Ozon Доставку" : "СДЭК";

  function change(next: boolean) {
    setChecked(next);
    setError("");
    startTransition(async () => {
      try {
        const result = await setDeliveryAvailability(carrier, next);
        if (result.error) { setChecked(!next); setError(result.error); return; }
        router.refresh();
      } catch {
        setChecked(!next);
        setError("Не удалось сохранить изменение. Попробуйте ещё раз.");
      }
    });
  }

  return <div className="delivery-availability">
    <label className="delivery-availability__label">
      <input type="checkbox" checked={checked} disabled={pending} onChange={event => change(event.target.checked)} />
      <span>Предлагать {name} покупателям</span>
    </label>
    <p className="muted" aria-live="polite">{pending ? "Сохраняем…" : checked ? "Включено при оформлении заказа" : "Не показывается при оформлении заказа"}</p>
    {error && <p className="notice notice--danger" role="alert">{error}</p>}
  </div>;
}
