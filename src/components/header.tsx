import Link from "next/link";
import { getStoreContacts } from "@/lib/settings";
import { Logo } from "@/components/logo";
import { CartIcon, UserIcon } from "@/components/icons";

const navigation = [["Каталог", "/catalog/"]];

export async function Header() {
  const contacts = await getStoreContacts();
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Интернет-магазин изделий с доставкой по России</span>
          <div><Link href="/delivery/">Доставка и оплата</Link><Link href="/contacts/">Контакты</Link>{contacts.email && <a href={"mailto:" + contacts.email}>{contacts.email}</a>}</div>
        </div>
      </div>
      <div className="container header-main">
        <Logo />
        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link href="/account/" aria-label="Личный кабинет"><UserIcon /></Link>
          <Link href="/cart/" aria-label="Корзина"><CartIcon /></Link>
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <Link href="/catalog/">Каталог</Link>
      </nav>
    </header>
  );
}
