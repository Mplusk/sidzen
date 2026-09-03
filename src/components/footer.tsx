import Link from "next/link";
import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo inverse />
          <p>Полезные изделия из каталога с выбором материала, цвета и доставкой по России.</p>
          <span className="footer-note">© {new Date().getFullYear()} 3DPRINTA</span>
        </div>
        <div><h3>Магазин</h3><Link href="/catalog/">Каталог</Link><Link href="/cart/">Корзина</Link><Link href="/account/">Личный кабинет</Link></div>
        <div><h3>Связаться</h3><a href="tel:+78003013003">8 800 301-30-03</a><a href="mailto:hello@3dprinta.shop">hello@3dprinta.shop</a><span>Пн–Пт, 9:00–19:00 МСК</span></div>
      </div>
      <div className="container footer-bottom"><Link href="/legal/privacy/">Политика конфиденциальности</Link><Link href="/legal/offer/">Публичная оферта</Link><Link href="/legal/cookies/">Cookies</Link></div>
    </footer>
  );
}
