import Link from "next/link";
import { Logo } from "@/components/logo";
import { getStoreContacts } from "@/lib/settings";
export async function Footer() {
  const contacts = await getStoreContacts();
  return <footer className="site-footer"><div className="container footer-grid">
    <div><Logo inverse /><p>Полезные изделия из каталога с выбором материала, цвета и доставкой по России.</p><span className="footer-note">© {new Date().getFullYear()} 3DPRINTA</span></div>
    <div><h3>Магазин</h3><Link href="/catalog/">Каталог</Link><Link href="/cart/">Корзина</Link><Link href="/account/">Личный кабинет</Link><Link href="/materials/">Материалы</Link><Link href="/delivery/">Доставка и оплата</Link></div>
    <div><h3>Информация</h3><Link href="/about/">О магазине</Link><Link href="/contacts/">Контакты и реквизиты</Link><Link href="/faq/">Вопросы и ответы</Link>{contacts.phone && <a href={"tel:" + contacts.phone.replace(/[^+\d]/g, "")}>{contacts.phone}</a>}{contacts.email && <a href={"mailto:" + contacts.email}>{contacts.email}</a>}{contacts.hours && <span>{contacts.hours}</span>}</div>
  </div><div className="container footer-bottom"><Link href="/legal/privacy/">Политика конфиденциальности</Link><Link href="/legal/offer/">Публичная оферта</Link><Link href="/legal/cookies/">Cookies</Link></div></footer>;
}
