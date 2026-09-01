import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false } };

const errors: Record<string, string> = { invalid: "Проверьте email и пароль.", "rate-limit": "Слишком много попыток. Повторите через 15 минут.", exists: "Аккаунт уже существует — войдите." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; returnTo?: string }> }) {
  const params = await searchParams;
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Личный кабинет</span><h1>Вход</h1><p className="muted">Заказы, модели, документы и статусы производства.</p>{params.error && <p className="notice notice--danger">{errors[params.error] ?? errors.invalid}</p>}<form action={loginAction}><input type="hidden" name="returnTo" value={params.returnTo ?? "/account/"} /><label className="field"><span>Email</span><input name="email" type="email" autoComplete="email" required /></label><label className="field"><span>Пароль</span><input name="password" type="password" autoComplete="current-password" minLength={10} required /></label><button className="button" type="submit">Войти</button></form><div className="auth-links"><Link href="/register/">Создать аккаунт</Link><Link href="/forgot-password/">Забыли пароль?</Link></div></div></div>;
}
