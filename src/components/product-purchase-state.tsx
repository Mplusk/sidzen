"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { defaultSelection, priceProduct, type ProductOptions, type ProductSelection } from "@/lib/product-options";
import { formatPrice } from "@/lib/format";

type PurchaseState = {
  product: ProductOptions;
  selection: ProductSelection;
  setSelection: Dispatch<SetStateAction<ProductSelection>>;
  quote: ReturnType<typeof priceProduct>;
};
const PurchaseContext = createContext<PurchaseState | null>(null);

export function ProductPurchaseState({ product, children }: { product: ProductOptions; children?: ReactNode }) {
  const [selection, setSelection] = useState(() => defaultSelection(product));
  const quote = priceProduct(product, selection);
  return <PurchaseContext.Provider value={{ product, selection, setSelection, quote }}>{children}</PurchaseContext.Provider>;
}

export function useProductPurchaseState(product: ProductOptions, initial?: ProductSelection, editing = false): PurchaseState {
  const shared = useContext(PurchaseContext);
  const [selection, setSelection] = useState(() => initial ?? defaultSelection(product));
  if (!editing && shared?.product.id === product.id) return shared;
  return { product, selection, setSelection, quote: priceProduct(product, selection) };
}

export function ProductMobilePrice({ oldPrice }: { oldPrice?: number | null }) {
  const state = useContext(PurchaseContext);
  if (!state) throw new Error("ProductMobilePrice requires ProductPurchaseState");
  const { product, quote } = state;
  const discounted = oldPrice != null && oldPrice > quote.unitPrice;
  return <div className="product-mobile-price" aria-label="Цена товара">
    <div className="product-mobile-price__amount"><strong>{formatPrice(quote.unitPrice)}</strong>{discounted && <><s>{formatPrice(oldPrice)}</s><span className="product-card__discount">−{Math.round((1 - quote.unitPrice / oldPrice) * 100)}%</span></>}<small>за 1 шт.</small></div>
    <span className={"product-card__availability" + (product.stock > 0 || product.madeToOrder ? " is-available" : "")}>{product.stock > 0 ? "В наличии" : product.madeToOrder ? "Под заказ" : "Нет в наличии"}</span>
  </div>;
}
