import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { getStoreContacts } from "@/lib/settings";
export const metadata: Metadata = { title: "Контакты и реквизиты", description: "Контакты продавца и информация для покупателей SIDZEN.", alternates: { canonical: "/contacts/" } };
export default async function ContactsPage() {
  const contacts = await getStoreContacts();
  return <div className="container prose-page"><Breadcrumbs items={[{ label: "Контакты", href: "/contacts/" }]} /><h1>Контакты и реквизиты</h1><p>По вопросам покупки укажите номер заказа. Информация о заказах доступна в <Link className="text-link" href="/account/orders/">личном кабинете</Link>.</p>
    <h2>Связаться с магазином</h2>
    {contacts.phone && <p>Телефон: <a className="text-link" href={"tel:" + contacts.phone.replace(/[^+\d]/g, "")}>{contacts.phone}</a></p>}
    {contacts.email && <p>Email: <a className="text-link" href={"mailto:" + contacts.email}>{contacts.email}</a></p>}
    {!contacts.phone && !contacts.email && <p>Контактные данные продавца пока не опубликованы.</p>}
    {contacts.hours && <p>Часы работы: {contacts.hours}</p>}{contacts.address && <p>Адрес самовывоза: {contacts.address}</p>}
    <h2>Реквизиты продавца</h2>{contacts.legalName ? <dl className="spec-list">{[["Продавец", contacts.legalName], ["ИНН", contacts.inn], ["ОГРН / ОГРНИП", contacts.ogrn], ["Юридический адрес", contacts.legalAddress], ["Банк", contacts.bank]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>Реквизиты продавца пока не опубликованы. До их публикации не переводите деньги по реквизитам из сторонних сообщений.</p>}
  </div>;
}
