import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const links = [["Обзор", "/account/"], ["Заказы", "/account/orders/"], ["Документы", "/account/documents/"], ["Профиль", "/account/profile/"], ["Персональные данные", "/account/privacy/"]];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <div className="container account-shell"><aside className="account-nav"><div style={{ padding: 18, borderBottom: "1px solid var(--line)" }}><strong>{user.name ?? "Покупатель"}</strong><br /><small className="muted">{user.email}</small></div>{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}{(user.permissions.has("settings.write") || user.roles.includes("superadmin")) && <><Link href="/account/integrations/">Доставка и оплата</Link><Link href="/account/marketplaces/">Маркетплейсы</Link></>}{user.permissions.has("dashboard.view") && <Link href="/admin/">Кабинет управления</Link>}<form action={logoutAction}><button type="submit">Выйти</button></form></aside><section className="account-content">{children}</section></div>;
}
