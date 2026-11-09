import { NavLink as Link } from "@/components/nav-link";
import { SubmitButton } from "@/components/submit-button";
import { CollapsibleNavigation } from "@/components/collapsible-navigation";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const links = [["Обзор", "/account/"], ["Заказы", "/account/orders/"], ["Избранное", "/favorites/"], ["Мои отзывы", "/account/reviews/"], ["Профиль", "/account/profile/"]];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const superadmin = user.roles.includes("superadmin");
  const managementLinks = [
    { label: "Заявки покупателей", href: "/admin/orders/", visible: user.permissions.has("orders.read") || superadmin },
    { label: "Клиенты", href: "/account/clients/", visible: user.permissions.has("customers.read") || superadmin },
    { label: "Мониторинг", href: "/account/monitoring/", visible: user.permissions.has("monitoring.read") || superadmin },
    { label: "Подключения магазина", href: "/account/integrations/", visible: user.permissions.has("settings.write") || superadmin },
    { label: "Маркетплейсы", href: "/account/marketplaces/", visible: user.permissions.has("settings.write") || superadmin },
    { label: "Проверка отзывов", href: "/account/review-moderation/", visible: user.permissions.has("content.write") || superadmin },
    { label: "Логи", href: "/account/logs/", visible: user.permissions.has("settings.write") || superadmin },
    { label: "Кабинет управления", href: "/admin/", visible: user.permissions.has("dashboard.view") },
  ].filter(link => link.visible);

  return <div className="container account-shell ym-hide-content ym-disable-keys">
    <div className="account-sidebar">
      <aside className="account-nav" aria-label="Личный кабинет">
        <div className="account-nav__identity"><strong>{user.name ?? "Покупатель"}</strong><br /><small className="muted">{user.email}</small></div>
        <CollapsibleNavigation label="Разделы личного кабинета">{links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</CollapsibleNavigation>
        <form action={logoutAction}><SubmitButton className="account-nav__logout" pendingLabel="Выходим…">Выйти</SubmitButton></form>
      </aside>
      {managementLinks.length > 0 && <aside className="account-nav account-nav--management" aria-label="Управление магазином">
        <h2 className="account-nav__group-title">Управление магазином</h2>
        <CollapsibleNavigation label="Управление магазином">{managementLinks.map(({ label, href }) => <Link href={href} key={href}>{label}</Link>)}</CollapsibleNavigation>
      </aside>}
    </div>
    <section className="account-content">{children}</section>
  </div>;
}
