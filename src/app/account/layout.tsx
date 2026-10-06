import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const links = [["Обзор", "/account/"], ["Заказы", "/account/orders/"], ["Мои отзывы", "/account/reviews/"], ["Документы", "/account/documents/"], ["Профиль", "/account/profile/"], ["Персональные данные", "/account/privacy/"]];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const logsLink = (user.permissions.has("settings.write") || user.roles.includes("superadmin")) ? <Link href="/account/logs/">Логи</Link> : null;
  const reviewsLink = (user.permissions.has("content.write") || user.roles.includes("superadmin")) ? <Link href="/account/review-moderation/">Проверка отзывов</Link> : null;
  const applicationsLink = (user.permissions.has("orders.read") || user.roles.includes("superadmin")) ? <Link href="/admin/orders/">Заявки покупателей</Link> : null;
  return <div className="container account-shell"><aside className="account-nav"><div style={{ padding: 18, borderBottom: "1px solid var(--line)" }}><strong>{user.name ?? "Покупатель"}</strong><br /><small className="muted">{user.email}</small></div>{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}{applicationsLink}{(user.permissions.has("settings.write") || user.roles.includes("superadmin")) && <><Link href="/account/integrations/">Подключения магазина</Link><Link href="/account/marketplaces/">Маркетплейсы</Link></>}{reviewsLink}{logsLink}{user.permissions.has("dashboard.view") && <Link href="/admin/">Кабинет управления</Link>}<form action={logoutAction}><button type="submit">Выйти</button></form></aside><section className="account-content">{children}</section></div>;
}
