import Link from "next/link";
import { Logo } from "@/components/logo";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";

const nav = [["Дашборд", "/admin/"], ["Заказы", "/admin/orders/"], ["Товары", "/admin/products/"], ["Каталог", "/admin/catalog/"], ["Доставка и оплата", "/account/integrations/"], ["SEO", "/admin/seo/"], ["Пользователи", "/admin/users/"], ["Настройки", "/admin/settings/"], ["Аудит", "/admin/audit/"]];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission(PERMISSIONS.dashboardView);
  return <div className="admin-shell"><aside className="admin-sidebar"><Logo inverse /><nav>{nav.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav><div className="admin-sidebar__bottom"><strong>{user.name ?? user.email}</strong><br /><span>{user.roles.join(", ")}</span><br /><Link href="/account/">В личный кабинет</Link></div></aside><main className="admin-main">{children}</main></div>;
}
