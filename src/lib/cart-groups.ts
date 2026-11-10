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

