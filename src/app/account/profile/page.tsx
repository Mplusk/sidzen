import { SubmitButton } from "@/components/submit-button";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { updateProfileAction } from "@/app/actions/auth";
import { AccountPrivacyConsent } from "@/components/account-privacy-consent";
import { operatorReady } from "@/lib/privacy";
import { setSocialPassword } from "@/app/actions/social";

export const metadata: Metadata = { title: "Профиль", robots: { index: false, follow: false } };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; social?: string }> }) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!await operatorReady()) return <><h1>Профиль</h1><p className="notice notice--danger">Изменение профиля временно недоступно: нужны сведения оператора и подтверждение размещения базы данных и резервных копий в России.</p></>;
  const passwordMessages: Record<string, string> = { password: "Проверьте пароль (не менее 10 символов), повтор пароля и согласие.", "password-set": "Пароль задан. Теперь можно войти через email и пароль.", rate: "Слишком много попыток. Повторите через минуту." };
  return <><span className="eyebrow">Настройки</span><h1>Профиль</h1>
    {params.saved && <p className="notice notice--success">Данные сохранены.</p>}
    {params.error && <p className="notice notice--danger">Проверьте поля формы и отдельное согласие.</p>}
    {params.social && passwordMessages[params.social] && <p role="status" className="notice">{passwordMessages[params.social]}</p>}
    <form action={updateProfileAction} className="configurator__panel" style={{ maxWidth: 760 }}><div className="form-grid">
      <label className="field"><span>Имя</span><input name="name" defaultValue={user.name ?? ""} required /></label>
      <label className="field"><span>Телефон</span><input name="phone" defaultValue={user.phone ?? ""} /></label>
      <label className="field field--full"><span>Email</span><input value={user.email} disabled /><small>Для смены email обратитесь в поддержку.</small></label>
      <label className="field"><span>Компания</span><input name="company" defaultValue={user.company ?? ""} /></label>
      <label className="field"><span>ИНН</span><input name="taxId" defaultValue={user.taxId ?? ""} /></label>
    </div><AccountPrivacyConsent /><SubmitButton className="button" style={{ marginTop: 24 }} pendingLabel="Сохраняем…">Сохранить</SubmitButton></form>
    {user.passwordHash === "!social-only" && <section className="content-card"><h2>Пароль для входа</h2><p>Задайте пароль, чтобы входить в магазин по email и паролю.</p><form action={setSocialPassword}><label className="field">Новый пароль<input name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label><label className="field">Повторите пароль<input name="repeatPassword" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label><AccountPrivacyConsent /><SubmitButton className="button button--small" pendingLabel="Сохраняем…">Задать пароль</SubmitButton></form></section>}
  </>;
}
