import { SubmitButton } from "@/components/submit-button";
import { saveSocialIntegration } from "@/app/actions/social";
import { callbackUrl, getSocialConfig, providers, providerNames, socialReady } from "@/lib/social/config";

const registration = { google: "https://console.cloud.google.com/auth/clients", vk: "https://id.vk.ru/about/business/go", yandex: "https://oauth.yandex.ru/client/new" };
export async function SocialSettings() {
  const configs = await Promise.all(providers.map(async provider => ({ provider, config: await getSocialConfig(provider) })));
  return <section id="social-login" className="content-card"><h2>Вход через Google, ВКонтакте и Яндекс</h2>
    <p>Создайте отдельное приложение каждого сервиса для сайта sidzen.shop. Ключи маркетплейса и доставки для входа покупателей не подходят. Кнопка появится на странице входа после заполнения и включения настроек.</p>
    <p className="muted">Если приложение зарегистрировано для прежнего сайта, обновите доверенный домен на sidzen.shop и адрес возврата в кабинете провайдера. Новые адреса приведены ниже; сайт не меняет настройки внешнего приложения автоматически.</p>
    {configs.map(({ provider, config }) => <section className="social-settings__provider" key={provider}><h3>{providerNames[provider]} · {socialReady(provider, config) ? "включён" : "выключен"}</h3>
      <p><a className="text-link" href={registration[provider]} target="_blank" rel="noreferrer">Создать приложение {providerNames[provider]} →</a></p>
      <label className="field">Адрес возврата · Redirect URI<input readOnly value={callbackUrl(provider)} /><small>Скопируйте полностью, включая завершающий /. У Google тип клиента — веб-приложение; у VK ID — веб-сайт. Не используйте старый OAuth ВКонтакте.</small></label>
      <form action={saveSocialIntegration} className="form-grid" autoComplete="off"><input type="hidden" name="provider" value={provider} />
        <label className="field">{provider === "vk" ? "ID приложения · App ID" : "Client ID"}<input name="clientId" maxLength={256} defaultValue={config.clientId} /></label>
        {provider !== "vk" && <label className="field">Client Secret<input name="clientSecret" type="password" maxLength={2048} autoComplete="new-password" placeholder={config.clientSecret ? "Сохранён, скрыт. Пустое поле сохраняет ключ" : "Секрет приложения"} /><small>Хранится зашифрованным, не передаётся в браузер.</small></label>}
        {provider === "yandex" && <p className="field--full muted">Права приложения: login:info и login:email. Доступ к фото, телефону, почте и другим сервисам не требуется.</p>}
        {provider === "vk" && <p className="field--full muted">VK ID использует одноразовый код и PKCE. Секрет приложения не требуется. Для email настройте соответствующее право в кабинете VK ID.</p>}
        {provider === "google" && <p className="notice field--full">Google — иностранный сервис. До включения оператор должен проверить применимость и выполнить требования к трансграничной передаче, договорам и уведомлениям. Одной отметки здесь недостаточно: требуется отдельное подтверждение при настройке сервера. Сейчас подтверждение {process.env.GOOGLE_OAUTH_LEGAL_APPROVED === "true" ? "задано" : "не задано"}.</p>}
        <label className="field--full"><input type="checkbox" name="operatorReviewed" defaultChecked={config.operatorReviewed} /> Оператор проверил правила сервиса, основания обработки и необходимые организационные меры</label>
        {provider !== "vk" && <label><input type="checkbox" name="clearSecret" /> Удалить сохранённый секрет</label>}
        <label><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Показывать кнопку и разрешить вход</label>
        <SubmitButton className="button button--small" pendingLabel="Сохраняем…">Сохранить {providerNames[provider]}</SubmitButton>
      </form><p className="muted">Сохранение не подтверждает правильность ключей. Проверка выполняется при настоящем входе в сервис. При смене Client ID прежние привязки не переносятся автоматически; сохранение отменяет незавершённые попытки входа.</p>
    </section>)}
  </section>;
}
