"use client";

import { deleteCatalogOptionAction } from "@/app/actions/admin-catalog";
import type { CatalogKind } from "@/lib/catalog-admin";

export function DeleteCatalogOption({ kind, id, name, used }: { kind: CatalogKind; id: string; name: string; used: boolean }) {
  return <form action={deleteCatalogOptionAction} onSubmit={(event) => {
    if (!window.confirm(`Удалить «${name}»? Это действие нельзя отменить.`)) event.preventDefault();
  }}>
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
    <button className="text-link admin-delete-link" type="submit" disabled={used} title={used ? "Сначала уберите связь с товарами, вариантами, заказами или дочерними категориями" : `Удалить ${name}`}>Удалить</button>
  </form>;
}
