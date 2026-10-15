import type { Metadata } from "next";
import Link from "next/link";
import { getStoreContacts } from "@/lib/settings";
import { providers, providerNames, providerSchema } from "@/lib/social/config";
import { SOCIAL_CONSENT_VERSION, socialConsentText } from "@/lib/social/flow";
export const metadata: Metadata = { title: "Согласие на вход через внешний сервис" };
export default async function SocialConsent({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const [contacts, params] = await Promise.all([getStoreContacts(), searchParams]);
  const provider = providerSchema.safeParse(params.provider), selected = provider.success ? [provider.data] : providers;
  return <article className="container prose-page"><h1>Отдельное согласие на вход через внешний сервис</h1><p>Версия {SOCIAL_CONSENT_VERSION}. Согласие относится только к сервису, кнопку которого вы выбрали, и не заменяет согласие на создание кабинета.</p><h2>Оператор</h2><p>{contacts.legalName || "Оператор ещё не заполнен."} {contacts.legalAddress}. {contacts.email}</p>
    {selected.map(p => <section key={p}><h2>{providerNames[p]}</h2><p>{socialConsentText(p)}</p></section>)}
<p>Согласие даётся отдельной изначально пустой отметкой до перехода. Магазин сохраняет его текст, версию, выбранный сервис и время. Для незавершённой регистрации эта запись удаляется вместе с попыткой входа.</p><p>Пароли соцсетей вводятся только на их официальных страницах. Токены доступа используются сервером однократно для проверки личности и не сохраняются. Новый вход через внешние сервисы отключён. Ранее сохранённую привязку можно удалить по обращению оператору; разрешение приложению также можно отозвать в выбранном сервисе.</p><p><Link className="text-link" href="/contacts/">Контакты для обращения и отзыва согласия</Link> · <Link className="text-link" href="/legal/privacy/">Политика обработки данных</Link></p>
  </article>;
}
