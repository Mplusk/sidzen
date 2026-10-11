import { Logo } from "@/components/logo";
import { CartIcon, UserIcon, SearchIcon, CatalogIcon } from "@/components/icons";
import { NavLink } from "@/components/nav-link";

export function Header() {
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Формы природы. Предметы для дома. Доставка по России.</span>
        </div>
      </div>
      <div className="container header-main">
        <Logo />
        <NavLink className="header-catalog" href="/catalog/"><CatalogIcon aria-hidden="true" /><span>Каталог</span></NavLink>
        <form className="header-search" action="/catalog/" method="get" role="search">
          <label className="visually-hidden" htmlFor="shop-search">Поиск товаров</label>
          <input id="shop-search" name="q" type="search" placeholder="Найти предмет для дома" maxLength={160} />
          <button type="submit" aria-label="Найти товары"><SearchIcon aria-hidden="true" /></button>
        </form>
        <nav className="header-actions" aria-label="Основная навигация">
          <NavLink href="/account/" aria-label="Личный кабинет" exact={false}><UserIcon aria-hidden="true" /><span>Кабинет</span></NavLink>
          <NavLink href="/cart/" aria-label="Корзина"><CartIcon aria-hidden="true" /><span>Корзина</span></NavLink>
        </nav>
      </div>
    </header>
  );
}
