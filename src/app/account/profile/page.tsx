import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { updateProfileAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Профиль", robots: { index: false, follow: false } };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  return <><span className="eyebrow">Настройки</span><h1>Профиль</h1>{params.saved && <p className="notice notice--success">Данные сохранены.</p>}{params.error && <p className="notice notice--danger">Проверьте поля формы.</p>}<form action={updateProfileAction} className="configurator__panel" style={{ maxWidth: 760 }}><div className="form-grid"><label className="field"><span>Имя</span><input name="name" defaultValue={user.name ?? ""} required /></label><label className="field"><span>Телефон</span><input name="phone" defaultValue={user.phone ?? ""} /></label><label className="field field--full"><span>Email</span><input value={user.email} disabled /><small>Для смены email обратитесь в поддержку.</small></label><label className="field"><span>Компания</span><input name="company" defaultValue={user.company ?? ""} /></label><label className="field"><span>ИНН</span><input name="taxId" defaultValue={user.taxId ?? ""} /></label></div><button className="button" style={{ marginTop: 24 }} type="submit">Сохранить</button></form></>;
}
