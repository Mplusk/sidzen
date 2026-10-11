import Link from "next/link";
import { Logo } from "@/components/logo";
export async function Footer() {
  return <footer className="site-footer"><div className="container footer-grid">
    <div><Logo inverse /><p>Природные формы и выразительная фактура. Предметы, которые находят своё место в вашем доме.</p><span className="footer-note">© {new Date().getFullYear()} SIDZEN · 3D декор для дома</span></div>
    <div className="footer-info"><h3>Информация</h3><Link href="/about/">О магазине</Link><Link href="/contacts/">Контакты и реквизиты</Link><Link href="/faq/">Вопросы и ответы</Link><Link href="/delivery/">Доставка и заказ</Link></div>
  </div><div className="container footer-bottom"><Link href="/legal/privacy/">Политика конфиденциальности</Link><Link href="/legal/offer/">Публичная оферта</Link><Link href="/legal/cookies/">Cookies</Link></div></footer>;
}
