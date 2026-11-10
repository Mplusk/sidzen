import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { adminEmailProtectionEnabled } from "@/lib/admin-login-challenge";
import { enrollAdminEmailAction } from "@/app/actions/admin-login-enrollment";

const messages: Record<string, string> = {
  sent: "Письмо отправлено. Откройте ссылку в этом же браузере и отдельно подтвердите включение. До подтверждения действующий вход не изменится.",
  invalid: "Неверный пароль.",
  rate: "Слишком много попыток. Повторите через 15 минут.",
  "other-staff": "Есть другие активные сотрудники с доступом к управлению. Перед включением необходимо подтвердить их почтовые адреса и подготовить восстановление доступа.",
  unavailable: "Не удалось отправить письмо. Проверьте подключение почты и повторите попытку.",
  already: "Подтверждение входа уже включено.",
};

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const user = await requirePermission("settings.write", "/admin/security/");
  if (!user.roles.includes("superadmin")) redirect("/account/?error=forbidden");
  const enabled = await adminEmailProtectionEnabled();
  const { result } = await searchParams;
  return <section className="content-card"><h1>Защита входа</h1>
    {result && messages[result] && <p role="status">{messages[result]}</p>}
    <p>Подтверждение входа по почте: <strong>{enabled ? "включено" : "выключено"}</strong>.</p>
    {!enabled && <><p>После пароля на адрес {user.email} придёт ссылка. Для проверки откройте её в этом же браузере и подтвердите включение.</p><p>Включение доступно, только если другие активные сотрудники с правами управления отсутствуют. Для восстановления доступа потребуется доступ к серверу.</p>
      <form action={enrollAdminEmailAction}><label className="field">Ваш пароль<input type="password" name="password" autoComplete="current-password" required minLength={10} maxLength={200} /></label><button className="button" type="submit">Отправить ссылку для включения</button></form></>}
  </section>;
}

