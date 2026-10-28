import { NavLink as Link } from "@/components/nav-link";
import { SubmitButton } from "@/components/submit-button";
import { CollapsibleNavigation } from "@/components/collapsible-navigation";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const links = [["Обзор", "/account/"], ["Заказы", "/account/orders/"], ["Избранное", "/favorites/"], ["Мои отзывы", "/account/reviews/"], ["Профиль", "/account/profile/"]];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const logsLink = (user.permissions.has("settings.write") || user.roles.includes("superadmin")) ? <Link href="/account/logs/">Логи</Link> : null;
  const reviewsLink = (user.permissions.has("content.write") || user.roles.includes("superadmin")) ? <Link href="/account/review-moderation/">Проверка отзывов</Link> : null;
  const applicationsLink = (user.permissions.has("orders.read") || user.roles.includes("superadmin")) ? <Link href="/admin/orders/">Заявки покупателей</Link> : null;
  const clientsLink = (user.permissions.has("customers.read") || user.roles.includes("superadmin")) ? <Link href="/account/clients/">Клиенты</Link> : null;
  const monitoringLink = (user.permissions.has("monitoring.read") || user.roles.includes("superadmin")) ? <Link href="/account/monitoring/">Мониторинг</Link> : null;
  return <div className="container account-shell"><aside className="account-nav"><div className="account-nav__identity"><strong>{user.name ?? "Покупатель"}</strong><br /><small className="muted">{user.email}</small></div><CollapsibleNavigation label="Разделы личного кабинета">{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}{applicationsLink}{clientsLink}{monitoringLink}{(user.permissions.has("settings.write") || user.roles.includes("superadmin")) && <><Link href="/account/integrations/">Подключения магазина</Link><Link href="/account/marketplaces/">Маркетплейсы</Link></>}{reviewsLink}{logsLink}{user.permissions.has("dashboard.view") && <Link href="/admin/">Кабинет управления</Link>}</CollapsibleNavigation><form action={logoutAction}><SubmitButton className="account-nav__logout" pendingLabel="Выходим…">Выйти</SubmitButton></form></aside><section className="account-content">{children}</section></div>;
}
