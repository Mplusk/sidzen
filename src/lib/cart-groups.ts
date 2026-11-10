export type CartGroupMember = { id: string; quantity: number; revision: string; state: string };
type Line = { id: string; groupKey: string | null; groupState: string; quantity: number; updatedAt: Date };

/** Present identical valid lines together; storage remains untouched during rendering. */
export function groupCartItems<T extends Line>(items: T[]) {
  const groups: Array<T & { members: CartGroupMember[] }> = [];
  for (const item of items) {
    const member = { id: item.id, quantity: item.quantity, revision: item.updatedAt.toISOString(), state: item.groupState };
    const match = item.groupKey && groups.find(group => group.groupKey === item.groupKey && group.quantity + item.quantity <= 999);
    if (match) { match.quantity += item.quantity; match.members.push(member); }
    else groups.push({ ...item, members: [member] });
  }
  return groups;
}

/** Available quantity for this group after other configurations of the same product. */
export function maxCartGroupQuantity<T extends { id: string; productId: string | null; quantity: number; product: { madeToOrder: boolean } | null; options: { stock: number } | null }>(item: T, groups: T[]) {
  if (item.product?.madeToOrder) return 999;
  const other = groups.filter(group => group.id !== item.id && group.productId === item.productId).reduce((sum, group) => sum + group.quantity, 0);
  return Math.max(0, Math.min((item.options?.stock ?? 0) - other, 999));
}
