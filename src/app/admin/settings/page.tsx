import type { Metadata } from "next";
import { updateSettingAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Настройки магазина", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const settings = await prisma.siteSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  const groups = Object.groupBy(settings, (item) => item.group);
  return <><div className="admin-header"><div><span className="eyebrow">Без деплоя</span><h1>Настройки магазина</h1></div></div><div className="admin-grid">{Object.entries(groups).map(([group, items]) => <div className="admin-card" key={group}><h2>{group}</h2>{items?.map((item) => <form action={updateSettingAction} className="field" style={{ marginBottom: 18 }} key={item.id}><input type="hidden" name="key" value={item.key} /><span>{item.label ?? item.key}</span><div style={{ display: "flex", gap: 8 }}><input name="value" defaultValue={typeof item.value === "string" || typeof item.value === "number" ? String(item.value) : JSON.stringify(item.value)} /><button className="button button--small" type="submit">Сохранить</button></div><small>{item.key}</small></form>)}</div>)}</div></>;
}
