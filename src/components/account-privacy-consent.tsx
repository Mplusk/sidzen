import Link from "next/link";
export function AccountPrivacyConsent() {
  return <><p className="muted">Телефон и реквизиты компании необязательны. <Link className="text-link" href="/legal/privacy/" target="_blank">Политика обработки данных</Link></p><label className="checkout-consent"><input type="checkbox" name="privacyConsent" required /><span>Даю отдельное <Link href="/legal/consent/?purpose=account" target="_blank">согласие на обработку данных личного кабинета</Link>. Рекламных рассылок нет.</span></label></>;
}
