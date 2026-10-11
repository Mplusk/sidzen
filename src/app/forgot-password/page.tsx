import type { Metadata } from "next";
import Link from "next/link";
import { getStoreContacts } from "@/lib/settings";

export const metadata: Metadata = { title: "Восстановление пароля", robots: { index: false, follow: false } };

export default async function ForgotPasswordPage() {
  const contacts = await getStoreContacts();
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Доступ</span><h1>Восстановление</h1><p>До подключения транзакционной почты восстановление выполняет поддержка после проверки данных заказа.</p>{contacts.email ? <a className="button" href={`mailto:${contacts.email}?subject=Восстановление доступа`}>Написать в поддержку</a> : <Link className="button" href="/contacts/">Контакты поддержки</Link>}<div className="auth-links"><Link href="/login/">Вернуться ко входу</Link></div></div></div>;
}
