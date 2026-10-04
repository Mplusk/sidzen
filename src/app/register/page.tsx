import type { Metadata } from "next";
import Link from "next/link";
import { registerAction } from "@/app/actions/auth";
import { AccountPrivacyConsent } from "@/components/account-privacy-consent";
import { operatorReady } from "@/lib/privacy";
export const metadata: Metadata = { title: "Регистрация", robots: { index: false, follow: false } };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!await operatorReady()) return <div className="auth-shell"><div className="auth-card"><h1>Регистрация временно недоступна</h1><p>Продавец ещё не заполнил сведения оператора персональных данных: наименование, адрес и email.</p><Link className="text-link" href="/login/">Войти в существующий аккаунт</Link></div></div>;
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Новый аккаунт</span><h1>Регистрация</h1><p className="muted">Следите за заказами в кабинете. Покупать можно без регистрации.</p>{error && <p className="notice notice--danger" role="alert">{error === "consent" ? "Подтвердите отдельное согласие для создания кабинета." : error === "rate-limit" ? "Слишком много попыток. Повторите позже." : "Проверьте поля. Пароль — не короче 10 символов."}</p>}<form action={registerAction}><label className="field"><span>Имя</span><input name="name" autoComplete="name" minLength={2} maxLength={120} required /></label><label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label><label className="field"><span>Телефон (необязательно)</span><input name="phone" type="tel" autoComplete="tel" maxLength={30} /></label><label className="field"><span>Пароль</span><input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></label><AccountPrivacyConsent /><button className="button" type="submit">Создать аккаунт</button></form><div className="auth-links"><Link href="/login/">Уже есть аккаунт</Link></div></div></div>;
}
