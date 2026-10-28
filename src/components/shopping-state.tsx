"use client";
import { createContext, useContext, useOptimistic, useState, useTransition } from "react";
import { setFavorite } from "@/app/actions/favorites";
import { selectFavorite } from "@/lib/favorites-policy";
type ShoppingContextValue = { ids: string[]; cartQuantity: number; pending: boolean; toggle: (id: string, selected: boolean) => void };
const ShoppingContext = createContext<ShoppingContextValue>({ ids: [], cartQuantity: 0, pending: false, toggle: () => {} });
export function ShoppingState({ ids, cartQuantity, children }: { ids: string[]; cartQuantity: number; children?: React.ReactNode }) {
  const [optimistic, update] = useOptimistic(ids, (current, patch: { id: string; selected: boolean }) => selectFavorite(current, patch.id, patch.selected));
  const [pending, start] = useTransition(), [error, setError] = useState("");
  const toggle = (id: string, selected: boolean) => {
    if (pending) return;
    setError("");
    start(async () => {
      update({ id, selected });
      try { const result = await setFavorite(id, selected); if (result.error) setError(result.error); }
      catch { setError("Нет связи с сайтом. Попробуйте ещё раз."); }
    });
  };
  return <ShoppingContext.Provider value={{ ids: optimistic, cartQuantity, pending, toggle }}>{children}<div className="shopping-feedback" role="status" aria-live="polite">{error}</div></ShoppingContext.Provider>;
}
export const useShoppingState = () => useContext(ShoppingContext);
