import Link from "next/link";
import { getStoreContacts } from "@/lib/settings";
import { Logo } from "@/components/logo";
import { CartIcon, UserIcon, SearchIcon, CatalogIcon } from "@/components/icons";
import { NavLink } from "@/components/nav-link";

export async function Header() {
  const contacts = await getStoreContacts();
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Интернет-магазин изделий с доставкой по России</span>
          <div><Link href="/delivery/">Доставка и заказ</Link><Link href="/contacts/">Контакты</Link>{contacts.email && <a href={"mailto:" + contacts.email}>{contacts.email}</a>}</div>
        </div>
      </div>
      <div className="container header-main">
        <Logo />
        <NavLink className="header-catalog" href="/catalog/"><CatalogIcon aria-hidden="true" /><span>Каталог</span></NavLink>
        <form className="header-search" action="/catalog/" method="get" role="search">
          <label className="visually-hidden" htmlFor="shop-search">Поиск товаров</label>
          <input id="shop-search" name="q" type="search" placeholder="Искать в 3DPRINTA" maxLength={160} />
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
