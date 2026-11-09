import { saveSmtpSettings } from "@/app/actions/smtp-settings";
import { SubmitButton } from "@/components/submit-button";
import { getSmtpSettingsView } from "@/lib/smtp/config";

export async function SmtpSettings({ message, error = false }: { message?: string; error?: boolean }) {
  const config = await getSmtpSettingsView();
  return <section className="content-card" id="smtp">
    <h2>Почта SpaceWeb</h2>
    <p>Настройте подключение к почтовому ящику <strong>support@sidzen.shop</strong>. Сохранение пароля само по себе не включает автоматическую отправку писем.</p>
    <p className="muted">Пароль: {config.passwordConfigured ? "сохранён и скрыт" : "не задан"}. {config.checkedAt && `Последняя успешная проверка: ${new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.`}</p>
    {message && <p role={error ? "alert" : "status"} className={`notice ${error ? "notice--danger" : "notice--success"}`}>{message}</p>}
    <form action={saveSmtpSettings} className="form-grid" autoComplete="off">
      <input type="hidden" name="revision" value={config.revision} />
      <label className="field">Пароль почтового ящика<input name="password" type="password" autoComplete="new-password" maxLength={512} placeholder={config.passwordConfigured ? "Пустое поле сохранит прежний пароль" : "Введите пароль почтового ящика"} /><small>Пароль хранится зашифрованным и не показывается в кабинете.</small></label>
      {config.passwordConfigured && <label><input name="clearPassword" type="checkbox" /> Удалить сохранённый пароль</label>}
      <div className="form-actions"><SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton><SubmitButton name="verify" value="yes" className="button button--outline" pendingLabel="Проверяем…">Проверить и сохранить</SubmitButton></div>
    </form>
    <p className="muted">Проверка подтверждает подключение и авторизацию, но не отправляет тестовое письмо.</p>
  </section>;
}

