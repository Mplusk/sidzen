import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import { updateSettingAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { TOP_MAIL_SETTING } from "@/lib/top-mail";

export const metadata: Metadata = { title: "Настройки магазина", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  await requirePermission("settings.write");
  const settings = await prisma.siteSetting.findMany({ where: { group: { notIn: ["system", "integrations", "security"] }, NOT: { key: { startsWith: "security." } } }, orderBy: [{ group: "asc" }, { key: "asc" }] });
  const groups = Object.groupBy(settings, (item) => item.group);
  return <>
    <div className="admin-header"><div><span className="eyebrow">Без деплоя</span><h1>Настройки магазина</h1></div></div>
    <div className="admin-grid">{Object.entries(groups).map(([group, items]) => <div className="admin-card" key={group}>
      <h2>{group === "analytics" ? "Аналитика" : group}</h2>
      {items?.map((item) => <form action={updateSettingAction} className="field" style={{ marginBottom: 18 }} key={item.id}>
        <input type="hidden" name="key" value={item.key} />
        <label htmlFor={item.key}>{item.label ?? item.key}</label>
        <div style={{ display: "flex", gap: 8 }}>
          {item.key === TOP_MAIL_SETTING
            ? <select id={item.key} name="value" defaultValue={String(item.value === true)}>
                <option value="true">Включён</option><option value="false">Выключен</option>
              </select>
            : <input id={item.key} name="value" defaultValue={typeof item.value === "string" || typeof item.value === "number" ? String(item.value) : JSON.stringify(item.value)} />}
          <SubmitButton className="button button--small" pendingLabel="Сохраняем…">Сохранить</SubmitButton>
        </div>
        {item.key !== TOP_MAIL_SETTING && <small>{item.key}</small>}
      </form>)}
    </div>)}</div>
  </>;
}

