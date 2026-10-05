import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { updateProfileAction } from "@/app/actions/auth";
import { AccountPrivacyConsent } from "@/components/account-privacy-consent";
import { operatorReady } from "@/lib/privacy";
import { prisma } from "@/lib/prisma";
import { SocialLogin } from "@/components/social-login";
import { providerNames, providerSchema } from "@/lib/social/config";
import { disconnectSocialAccount, setSocialPassword } from "@/app/actions/social";

export const metadata: Metadata = { title: "Профиль", robots: { index: false, follow: false } };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; social?: string }> }) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  if (!await operatorReady()) return <><h1>Профиль</h1><p className="notice notice--danger">Изменение профиля временно недоступно: нужны сведения оператора и подтверждение размещения базы данных и резервных копий в России.</p></>;
  const accounts = await prisma.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const socialMessages: Record<string, string> = { linked: "Способ входа подключён.", removed: "Привязка удалена. Другие сессии завершены.", last: "Нельзя удалить единственный доступный способ входа. Сначала задайте пароль магазина или привяжите другой сервис.", password: "Проверьте пароль (не менее 10 символов), повтор пароля и согласие, если создаёте пароль.", "password-set": "Пароль магазина задан. Теперь можно войти через email и пароль.", missing: "Привязка уже удалена.", confirmation: "Подтвердите отключение выбранной привязки.", rate: "Слишком много попыток. Повторите через минуту." };
  return <><span className="eyebrow">Настройки</span><h1>Профиль</h1>
    {params.saved && <p className="notice notice--success">Данные сохранены.</p>}
    {params.error && <p className="notice notice--danger">Проверьте поля формы и отдельное согласие.</p>}
    {params.social && <p role="status" className="notice">{socialMessages[params.social] ?? "Повторите действие."}</p>}
    <form action={updateProfileAction} className="configurator__panel" style={{ maxWidth: 760 }}><div className="form-grid">
      <label className="field"><span>Имя</span><input name="name" defaultValue={user.name ?? ""} required /></label>
      <label className="field"><span>Телефон</span><input name="phone" defaultValue={user.phone ?? ""} /></label>
      <label className="field field--full"><span>Email</span><input value={user.email} disabled /><small>Для смены email обратитесь в поддержку.</small></label>
      <label className="field"><span>Компания</span><input name="company" defaultValue={user.company ?? ""} /></label>
      <label className="field"><span>ИНН</span><input name="taxId" defaultValue={user.taxId ?? ""} /></label>
    </div><AccountPrivacyConsent /><button className="button" style={{ marginTop: 24 }} type="submit">Сохранить</button></form>
    <section className="content-card"><h2>Способы входа</h2><p>Соцаккаунт привязывается только из вашего кабинета. Совпадение email не объединяет кабинеты.</p>
      {accounts.map(account => { const p = providerSchema.safeParse(account.provider); return <form key={account.id} action={disconnectSocialAccount} className="social-settings__provider">
        <h3>{p.success ? providerNames[p.data] : account.provider} · привязан</h3><input name="id" type="hidden" value={account.id} />
        {user.passwordHash.startsWith("scrypt$") && <label className="field">Пароль магазина<input name="password" type="password" required maxLength={200} autoComplete="current-password" /></label>}
        <label className="checkout-consent"><input name="confirmation" type="checkbox" required /><span>Подтверждаю отключение этой привязки. Вход через неё перестанет работать; другие сессии будут завершены.</span></label>
        <button className="button button--outline button--small" type="submit">Отключить привязку</button>
      </form>; })}
      {!accounts.length && <p className="muted">Соцаккаунты не подключены.</p>}
      {user.passwordHash === "!social-only" && <form action={setSocialPassword} className="social-settings__provider"><h3>Добавить обычный вход</h3><p>Пароль позволит войти без соцсети и отключить последнюю привязку.</p><label className="field">Новый пароль<input name="password" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label><label className="field">Повторите пароль<input name="repeatPassword" type="password" required minLength={10} maxLength={200} autoComplete="new-password" /></label><AccountPrivacyConsent /><button className="button button--small" type="submit">Задать пароль магазина</button></form>}
      <SocialLogin linking passwordRequired={user.passwordHash.startsWith("scrypt$")} linked={accounts} />
    </section>
  </>;
}
