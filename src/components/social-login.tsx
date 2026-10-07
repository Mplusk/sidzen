import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import Image from "next/image";
import { startSocialLogin } from "@/app/actions/social";
import { getSocialConfig, providers, providerNames, socialReady } from "@/lib/social/config";
import { operatorReady } from "@/lib/privacy";
import { headers } from "next/headers";
import { safeSocialReturn, siteOrigin } from "@/lib/social/config";
import { socialLoginHandoff } from "@/lib/storefront-domains";

export async function SocialLogin({ returnTo = "/account/", linking = false, passwordRequired = false, linked = [] }: { returnTo?: string; linking?: boolean; passwordRequired?: boolean; linked?: { provider: string; clientId: string }[] }) {
  if (!await operatorReady()) return null;
  const enabled = (await Promise.all(providers.map(async provider => ({ provider, config: await getSocialConfig(provider) })))).filter(({ provider, config }) => socialReady(provider, config) && !linked.some(account => account.provider === provider && account.clientId === config.clientId));
  if (!enabled.length) return null;
  const requestHeaders = await headers();
  const handoff = socialLoginHandoff(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), siteOrigin(), safeSocialReturn(returnTo), linking);
  if (handoff) return <section className="social-login"><h2>{linking ? "Подключить способ входа" : "Вход через другой аккаунт"}</h2><p className="muted">Вход через соцсети проходит на основном домене этого же магазина — 3dprinta.shop. Это сохраняет безопасный возврат из сервиса. Кабинет и заказы общие; на каждом домене нужно войти отдельно.</p><a className="button button--outline" href={handoff}>{linking ? "Перейти к подключению" : "Продолжить вход через соцсети"}</a></section>;
  return <section className="social-login"><h2>{linking ? "Подключить способ входа" : "Или через другой аккаунт"}</h2>
    <form action={startSocialLogin}>
      <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="intent" value={linking ? "link" : "login"} />
      {passwordRequired && <label className="field">Подтвердите пароль магазина<input type="password" name="password" autoComplete="current-password" maxLength={200} required /></label>}
      <label className="checkout-consent"><input name="socialConsent" type="checkbox" required /><span>Даю отдельное <Link className="text-link" href="/legal/social-login/" target="_blank">согласие на вход через выбранный сервис</Link> и получение моего идентификатора, имени и email. Обычный вход доступен без этого согласия.</span></label>
      <div className="social-login__buttons">{enabled.map(({ provider }) => <SubmitButton key={provider} name="provider" value={provider} aria-label={`Войти через ${providerNames[provider]}`} className={`button button--outline social-login__button social-login__button--${provider}`} pendingLabel="Открываем сервис…">
        {provider === "google" ? <Image src="/brand/google-sign-in.svg" width={180} height={40} alt="" unoptimized /> : <><span aria-hidden="true">{provider === "vk" ? "VK" : "Я"}</span>{providerNames[provider]}</>}
      </SubmitButton>)}</div>
    </form>
  </section>;
}
