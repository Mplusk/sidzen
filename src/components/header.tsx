import { Logo } from "@/components/logo";
import { CartIcon, UserIcon } from "@/components/icons";
import { CatalogSearchInput } from "@/components/catalog-search-input";
import { NavLink } from "@/components/nav-link";
import { CatalogMenu } from "@/components/catalog-menu";
import { getCatalogMenuCategories } from "@/lib/catalog";
import { Suspense } from "react";

export async function Header() {
  const categories = await getCatalogMenuCategories();
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Формы природы. Предметы для дома. Доставка по России.</span>
        </div>
      </div>
      <CatalogMenu categories={categories} logo={<Logo />} search={<Suspense fallback={null}><CatalogSearchInput /></Suspense>} actions={
        <nav className="header-actions" aria-label="Основная навигация">
          <NavLink href="/account/" aria-label="Личный кабинет" exact={false}><UserIcon aria-hidden="true" /><span>Кабинет</span></NavLink>
          <NavLink href="/cart/" aria-label="Корзина"><CartIcon aria-hidden="true" /><span>Корзина</span></NavLink>
        </nav>
      } />
    </header>
  );
}
