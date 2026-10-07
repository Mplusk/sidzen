"use client";

import { deleteCatalogOptionAction } from "@/app/actions/admin-catalog";
import type { CatalogKind } from "@/lib/catalog-admin";
import { ConfirmAction } from "@/components/confirm-action";

export function DeleteCatalogOption({ kind, id, name, used }: { kind: CatalogKind; id: string; name: string; used: boolean }) {
  return <ConfirmAction action={deleteCatalogOptionAction} title={`Удалить «${name}»?`} description="Этот элемент исчезнет из справочника. Действие нельзя отменить; новый элемент можно создать заново." trigger="Удалить" confirmLabel="Да, удалить" disabled={used} hint={used ? "Сначала уберите связи с товарами, вариантами, заказами или дочерними категориями." : undefined}>
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="id" value={id} />
  </ConfirmAction>;
}
