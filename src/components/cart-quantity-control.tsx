"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCheckoutCartGroup } from "@/app/actions/checkout-cart";
import type { CartGroupMember } from "@/lib/cart-groups";
import { QuantityStepper } from "@/components/quantity-stepper";
import styles from "./cart-quantity-control.module.css";

export function CartQuantityControl({ members, name, quantity, max, canAdjust }: { members: CartGroupMember[]; name: string; quantity: number; max: number; canAdjust: boolean }) {
  const router = useRouter();
  const [pending, startUpdate] = useTransition();
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const change = (next: number) => {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setError("");
    startUpdate(async () => {
      try {
        const result = await updateCheckoutCartGroup(members, next);
        if (result.error) setError(result.error);
        router.refresh();
      } catch { setError("Не удалось изменить количество. Повторите попытку."); }
      finally { inFlight.current = false; }
    });
  };
  return <div className={styles.wrapper}>
    <QuantityStepper name={name} quantity={quantity} max={max} disabled={!canAdjust} pending={pending} onChange={change} className={styles.control} errorClassName={styles.error} />
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
