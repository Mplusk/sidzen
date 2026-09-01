import Link from "next/link";
import { Logo } from "@/components/logo";
import { CartIcon, SearchIcon, UserIcon } from "@/components/icons";

const navigation = [
  ["Каталог", "/catalog/"],
  ["Печать по модели", "/print/"],
  ["Материалы", "/materials/"],
  ["Технологии", "/technologies/"],
  ["Блог", "/blog/"],
];

export function Header() {
  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <span>Производство и доставка по России</span>
          <div><a href="mailto:hello@3dprinta.shop">hello@3dprinta.shop</a><a href="tel:+78003013003">8 800 301-30-03</a></div>
        </div>
      </div>
      <div className="container header-main">
        <Logo />
        <nav className="main-nav" aria-label="Основная навигация">
          {navigation.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link href="/search/" aria-label="Поиск"><SearchIcon /></Link>
          <Link href="/account/" aria-label="Личный кабинет"><UserIcon /></Link>
          <Link href="/cart/" aria-label="Корзина"><CartIcon /></Link>
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        <Link href="/catalog/">Каталог</Link>
        <Link href="/print/">Печать по модели</Link>
        <Link href="/materials/">Материалы</Link>
        <Link href="/blog/">Блог</Link>
      </nav>
    </header>
  );
}
