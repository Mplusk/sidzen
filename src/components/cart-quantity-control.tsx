"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCheckoutCartGroup } from "@/app/actions/checkout-cart";
import type { CartGroupMember } from "@/lib/cart-groups";
import styles from "./cart-quantity-control.module.css";

export function CartQuantityControl({ members, name, quantity, max, canAdjust }: { members: CartGroupMember[]; name: string; quantity: number; max: number; canAdjust: boolean }) {
  const router = useRouter();
  const [pending, startUpdate] = useTransition();
  const [error, setError] = useState("");
  const change = (next: number) => {
    if (pending) return;
    setError("");
    startUpdate(async () => {
      try {
        const result = await updateCheckoutCartGroup(members, next);
        if (result.error) setError(result.error);
        router.refresh();
      } catch { setError("Не удалось изменить количество. Повторите попытку."); }
    });
  };
  return <div className={styles.wrapper}>
    <div className={styles.control} role="group" aria-label={`Количество: ${name}`} aria-busy={pending}>
      <button type="button" aria-label={`Уменьшить количество: ${name}`} disabled={pending || !canAdjust || max < 1 || quantity <= 1} onClick={() => change(Math.min(quantity - 1, max))}>−</button>
      <span aria-live="polite" aria-atomic="true">{quantity}</span>
      <button type="button" aria-label={`Увеличить количество: ${name}`} disabled={pending || !canAdjust || quantity >= max} onClick={() => change(quantity + 1)}>+</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

