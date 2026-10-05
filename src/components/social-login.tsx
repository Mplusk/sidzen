import Link from "next/link";
import { startSocialLogin } from "@/app/actions/social";
import { getSocialConfig, providers, providerNames, socialReady } from "@/lib/social/config";
import { operatorReady } from "@/lib/privacy";

export async function SocialLogin({ returnTo = "/account/", linking = false, passwordRequired = false, linked = [] }: { returnTo?: string; linking?: boolean; passwordRequired?: boolean; linked?: { provider: string; clientId: string }[] }) {
  if (!await operatorReady()) return null;
  const enabled = (await Promise.all(providers.map(async provider => ({ provider, config: await getSocialConfig(provider) })))).filter(({ provider, config }) => socialReady(provider, config) && !linked.some(account => account.provider === provider && account.clientId === config.clientId));
  if (!enabled.length) return null;
  return <section className="social-login"><h2>{linking ? "Подключить способ входа" : "Или через другой аккаунт"}</h2>
    <form action={startSocialLogin}>
      <input type="hidden" name="returnTo" value={returnTo} /><input type="hidden" name="intent" value={linking ? "link" : "login"} />
      {passwordRequired && <label className="field">Подтвердите пароль магазина<input type="password" name="password" autoComplete="current-password" maxLength={200} required /></label>}
      <label className="checkout-consent"><input name="socialConsent" type="checkbox" required /><span>Даю отдельное <Link className="text-link" href="/legal/social-login/" target="_blank">согласие на вход через выбранный сервис</Link> и получение моего идентификатора, имени и email. Обычный вход доступен без этого согласия.</span></label>
      <div className="social-login__buttons">{enabled.map(({ provider }) => <button key={provider} type="submit" name="provider" value={provider} className={`button button--outline social-login__button social-login__button--${provider}`}><span aria-hidden="true">{{ google: "G", vk: "VK", yandex: "Я" }[provider]}</span>{providerNames[provider]}</button>)}</div>
    </form>
  </section>;
}
