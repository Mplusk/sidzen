import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { completeSocialRegistration } from "@/app/actions/social";
import { getCurrentUser } from "@/lib/auth";
import { pendingProfile, SOCIAL_COOKIE } from "@/lib/social/flow";
import { providerNames, providerSchema } from "@/lib/social/config";
import { AccountPrivacyConsent } from "@/components/account-privacy-consent";
import { socialLoginEnabled } from "@/lib/social/config";
export const metadata: Metadata = { title: "Завершение регистрации", robots: { index: false, follow: false } };
export default async function SocialRegistration({ searchParams }: { searchParams: Promise<{ provider?: string; error?: string }> }) {
  if (!socialLoginEnabled()) redirect("/login/?error=social-unavailable");
  if (await getCurrentUser()) redirect("/account/");
  const params = await searchParams, provider = providerSchema.safeParse(params.provider);
  if (!provider.success) redirect("/login/?error=social-expired");
  const pending = await pendingProfile(provider.data, (await cookies()).get(SOCIAL_COOKIE(provider.data))?.value ?? "");
  if (!pending) redirect("/login/?error=social-expired");
  return <div className="auth-shell"><div className="auth-card"><h1>Ваш кабинет</h1><p>Вход через {providerNames[provider.data]} подтверждён. Проверьте контактные данные перед созданием кабинета.</p>
    {params.error && <p role="alert" className="notice notice--danger">{params.error === "exists" ? "Не удалось создать кабинет с этим email. Если вы уже зарегистрированы, войдите обычным способом и привяжите соцаккаунт в профиле. Кабинеты автоматически не объединяются." : params.error === "consent" ? "Нужно отдельное согласие на обслуживание кабинета." : "Проверьте имя, email и пароль (если указан — не менее 10 символов)."}</p>}
    <form action={completeSocialRegistration}><input type="hidden" name="provider" value={provider.data} />
      <label className="field">Имя<input name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={pending.profile.name} /></label>
      <label className="field">Email для связи<input name="email" type="email" required maxLength={254} autoComplete="email" defaultValue={pending.profile.email} /></label>
      <label className="field">Пароль магазина · необязательно<input name="password" type="password" minLength={10} maxLength={200} autoComplete="new-password" /><small>Позволяет войти без соцсети. Если оставить пустым, вход будет только через привязанный сервис.</small></label>
      <AccountPrivacyConsent /><SubmitButton className="button" pendingLabel="Создаём кабинет…">Создать кабинет</SubmitButton>
    </form><p><Link className="text-link" href="/login/?returnTo=%2Faccount%2Fprofile%2F">Уже есть кабинет? Войти и привязать аккаунт</Link></p><p className="muted">Данные этой попытки автоматически удаляются через 10 минут. Не завершайте регистрацию на общем устройстве за другого человека.</p>
  </div></div>;
}
