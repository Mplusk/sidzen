import Link from "next/link";
import { Logo } from "@/components/logo";
export async function Footer() {
  return <footer className="site-footer">
    <div className="container footer-grid">
      <div className="footer-brand">
        <Logo inverse />
        <p className="footer-description">Природные формы и выразительная фактура. Предметы, которые находят своё место в вашем доме.</p>
      </div>
      <nav className="footer-info" aria-labelledby="footer-information-heading">
        <h3 id="footer-information-heading">Информация</h3>
        <Link href="/about/">О магазине</Link>
        <Link href="/contacts/">Контакты и реквизиты</Link>
        <Link href="/faq/">Вопросы и ответы</Link>
        <Link href="/delivery/">Доставка и заказ</Link>
      </nav>
    </div>
    <div className="container footer-bottom">
      <span className="footer-note">© {new Date().getFullYear()} SIDZEN · 3D декор для дома</span>
      <nav className="footer-legal" aria-label="Правовая информация">
        <Link href="/legal/privacy/">Политика конфиденциальности</Link>
        <Link href="/legal/offer/">Публичная оферта</Link>
        <Link href="/legal/cookies/">Cookies</Link>
      </nav>
    </div>
  </footer>;
}
