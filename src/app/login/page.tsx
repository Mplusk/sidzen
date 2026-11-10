import { SubmitButton } from "@/components/submit-button";
import { ValidatedInput } from "@/components/validated-input";
import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Вход", robots: { index: false, follow: false } };

const errors: Record<string, string> = { invalid: "Проверьте email и пароль.", "rate-limit": "Слишком много попыток. Повторите через 15 минут.", exists: "Аккаунт уже существует — войдите.", "social-unavailable": "Вход через внешние сервисы отключён. Используйте email и пароль.", "social-expired": "Попытка входа истекла или уже использована. Начните вход заново.", "social-canceled": "Вход отменён в выбранном сервисе.", "social-consent": "Перед переходом дайте отдельное согласие на выбранный способ входа.", "social-operator": "Вход через внешний сервис временно недоступен: оператор магазина должен завершить настройку обработки данных.", "social-conflict": "Этот соцаккаунт уже привязан к другому кабинету либо у вашего кабинета есть другая привязка. Кабинеты не объединены.", "social-link-session": "Для привязки войдите в свой кабинет заново.", "social-session": "Для привязки сначала войдите в свой кабинет.", "social-failed": "Не удалось завершить вход. Повторите попытку или используйте email и пароль. Если ошибка повторяется, администратору нужно проверить ключи, права приложения и адрес возврата." };
errors["email-confirmation-unavailable"] = "Не удалось отправить письмо или превышен лимит запросов. Повторите попытку позднее.";
errors["admin-confirmation-required"] = "Для доступа к управлению войдите заново и подтвердите вход по ссылке из письма.";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; returnTo?: string }> }) {
  const params = await searchParams;
  return <div className="auth-shell"><div className="auth-card"><span className="eyebrow">Личный кабинет</span><h1>Вход</h1><p className="muted">Заказы, документы и статусы доставки.</p>{params.error && <p role="alert" className="notice notice--danger">{errors[params.error] ?? errors.invalid}</p>}<form action={loginAction}><input type="hidden" name="returnTo" value={params.returnTo ?? "/account/"} /><label className="field"><span>Email</span><ValidatedInput aria-label="Email" name="email" type="email" autoComplete="email" required /></label><label className="field"><span>Пароль</span><ValidatedInput aria-label="Пароль" name="password" type="password" autoComplete="current-password" minLength={10} required /></label><SubmitButton className="button" pendingLabel="Входим…">Войти</SubmitButton></form><div className="auth-links"><Link href="/register/">Создать аккаунт</Link><Link href="/forgot-password/">Забыли пароль?</Link></div></div></div>;
}

