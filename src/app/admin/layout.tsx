import { NavLink as Link } from "@/components/nav-link";
import { Logo } from "@/components/logo";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { CollapsibleNavigation } from "@/components/collapsible-navigation";

const nav = [["Дашборд", "/admin/"], ["Заявки и заказы", "/admin/orders/"], ["Товары", "/admin/products/"], ["Каталог", "/admin/catalog/"], ["Подключения магазина", "/account/integrations/"], ["Маркетплейсы", "/account/marketplaces/"], ["SEO", "/admin/seo/"], ["Пользователи", "/admin/users/"], ["Настройки", "/admin/settings/"], ["Аудит", "/admin/audit/"], ["Архив обращений", "/admin/privacy/"]];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission(PERMISSIONS.dashboardView);
  return <div className="admin-shell"><aside className="admin-sidebar"><Logo inverse /><CollapsibleNavigation label="Разделы управления магазином">{nav.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}{(user.permissions.has(PERMISSIONS.customersRead) || user.roles.includes("superadmin")) && <Link href="/account/clients/">Клиенты</Link>}</CollapsibleNavigation><div className="admin-sidebar__bottom"><strong>{user.name ?? user.email}</strong><br /><span>{user.roles.join(", ")}</span><br /><Link href="/account/">В личный кабинет</Link></div></aside><section className="admin-main">{children}</section></div>;
}
