import type { Metadata } from "next";
import Link from "next/link";
import { registerAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false, follow: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Новый аккаунт</span><h1>Регистрация</h1><p className="muted">Следите за заказами и получайте документы в личном кабинете.</p>{error && <p className="notice notice--danger">Заполните поля корректно. Пароль — не короче 10 символов.</p>}<form action={registerAction}><label className="field"><span>Имя</span><input name="name" autoComplete="name" required /></label><label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label><label className="field"><span>Телефон</span><input name="phone" type="tel" autoComplete="tel" /></label><label className="field"><span>Пароль</span><input name="password" type="password" autoComplete="new-password" minLength={10} required /><small>Минимум 10 символов</small></label><button className="button" type="submit">Создать аккаунт</button></form><div className="auth-links"><Link href="/login/">Уже есть аккаунт</Link></div></div></div>;
}
