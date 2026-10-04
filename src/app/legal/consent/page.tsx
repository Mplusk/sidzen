import type { Metadata } from "next";
import Link from "next/link";
import { getStoreContacts } from "@/lib/settings";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/privacy-documents";
export const metadata: Metadata = { title: "Отдельное согласие на обработку данных" };
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ purpose?: string }> }) {
  const [contacts, params] = await Promise.all([getStoreContacts(), searchParams]);
  const purpose = params.purpose === "ozon" ? "ozon" : "account";
  return <article className="container prose-page"><h1>{purpose === "ozon" ? "Согласие на расчёт доставки Ozon" : "Согласие на обслуживание кабинета"}</h1><p>Самостоятельный документ, версия {CONSENT_VERSION}. Не является офертой, политикой или согласием на рекламу.</p><h2>Оператор</h2><p>{contacts.legalName || "Продавец ещё не указал наименование оператора."} {contacts.inn && `ИНН ${contacts.inn}.`} {contacts.legalAddress}</p><p>{CONSENT_TEXT[purpose]}</p><h2>Как дать и отозвать согласие</h2><p>Предоставляется отдельной, изначально не установленной отметкой в соответствующей форме; сервер фиксирует версию, содержание и время. Посещение сайта согласия не даёт. Отзыв: <Link className="text-link" href="/account/privacy/">личный кабинет</Link>{contacts.email && <> или <a className="text-link" href={`mailto:${contacts.email}`}>{contacts.email}</a></>}.</p><p><Link className="text-link" href="/legal/privacy/">Политика обработки данных</Link></p></article>;
}
