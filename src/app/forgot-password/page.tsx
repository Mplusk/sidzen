import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Восстановление пароля", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Доступ</span><h1>Восстановление</h1><p>До подключения транзакционной почты восстановление выполняет поддержка после проверки данных заказа.</p><a className="button" href="mailto:support@3dprinta.shop?subject=Восстановление доступа">Написать в поддержку</a><div className="auth-links"><Link href="/login/">Вернуться ко входу</Link></div></div></div>;
}
