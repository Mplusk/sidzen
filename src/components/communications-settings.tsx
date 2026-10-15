import { getTelegramConfig } from "@/lib/telegram/config";
import { getReviewAiConfig, reviewTransferApproved } from "@/lib/review-ai/config";
import { prisma } from "@/lib/prisma";
import { saveTelegramSettings, testTelegramSettings, saveReviewAiSettings, retryTelegramNotifications } from "@/app/actions/communications";
import { SubmitButton } from "@/components/submit-button";
export async function CommunicationsSettings() {
  const transferApproved = reviewTransferApproved();
  const [telegram, reviews, failed] = await Promise.all([getTelegramConfig(), getReviewAiConfig(), prisma.telegramOrderJob.count({ where: { status: { in: ["FAILED", "UNCERTAIN"] }, order: { deletedAt: null } } })]);
  return <div id="communications">
    <section className="content-card"><h2>Telegram · уведомления о новых заказах</h2><p>Создайте бота через @BotFather и отправьте ему /start (или добавьте в свою группу). Введите токен бота и числовой Chat ID получателя. Пароль вашей Telegram-учётки не нужен.</p>
      <p className="muted">Уведомление содержит только ссылку на заказ. ФИО, телефон, email, адрес и комментарии покупателя остаются в защищённом кабинете на сайте. Токен хранится зашифрованным.</p>
      <form action={saveTelegramSettings} className="form-grid" autoComplete="off"><input type="hidden" name="revision" value={telegram.revision} />
        <label className="field">Токен бота<input name="token" type="password" autoComplete="new-password" maxLength={150} placeholder={telegram.token ? "Сохранён; пустое поле оставит прежний токен" : "123456789:…"} /></label>
        <label className="field">Chat ID<input name="chatId" defaultValue={telegram.chatId} maxLength={21} placeholder="123456789 или -100… для группы" /><small>Числовой ID чата, не @username и не телефон. Получите через getUpdates вашего бота после /start; не публикуйте URL с токеном.</small></label>
        <label><input type="checkbox" name="enabled" defaultChecked={telegram.enabled} /> Уведомлять о новых заказах</label><label><input type="checkbox" name="clearToken" /> Удалить токен</label>
        <SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton><SubmitButton name="verify" value="yes" className="button button--outline" pendingLabel="Проверяем…">Проверить и сохранить</SubmitButton>
      </form>
      <form action={testTelegramSettings}><SubmitButton className="button button--small" pendingLabel="Отправляем…">Отправить тестовое уведомление</SubmitButton></form>
      <p className="muted">Новые заказы после включения попадают в очередь автоматически. Старые заказы не рассылаются. При ограничениях API выполняются повторы. Если после таймаута результат отправки неизвестен, автоматический повтор остановлен во избежание дублей.</p>
      {failed > 0 && <form action={retryTelegramNotifications} className="form-grid"><p className="notice">Неотправленные / неподтверждённые уведомления: {failed}.</p><label className="checkbox-row"><input type="checkbox" name="confirmation" required /> Подтверждаю повтор. Если Telegram уже принял сообщение до таймаута, возможен дубль.</label><SubmitButton className="button button--small" pendingLabel="Ставим в очередь…">Повторить неотправленные уведомления</SubmitButton></form>}
    </section>
<section className="content-card"><h2>DeepSeek · модерация отзывов</h2><p>Используется ключ и модель из настроек DeepSeek выше. Только при серверном разрешении передачи и отдельном согласии покупателя новые текстовые отзывы могут проходить автоматическую проверку. Корректные отзывы публикуются; сомнительные, фото и ошибки API направляются в «Проверка отзывов» с причиной. Старые отзывы не перепроверяются.</p>
      {!transferApproved && <p className="notice" role="status">Передача отзывов в DeepSeek запрещена на сервере. Все отзывы проверяет администратор. Для включения оператор должен документально проверить получателя, правовые основания и необходимые уведомления, затем отдельно подтвердить это в конфигурации сервера. Галочки ниже и согласие автора не заменяют эту проверку.</p>}
      <form action={saveReviewAiSettings} className="form-grid"><input type="hidden" name="revision" value={reviews.revision} />
        <label className="checkbox-row"><input type="checkbox" name="operatorReviewed" defaultChecked={reviews.operatorReviewed} /> Подтверждаю проверку условий обработки и трансграничной передачи текста в DeepSeek, необходимых уведомлений и правовых оснований оператором магазина. Данные профиля, заказа и фото не передаются.</label>
        <label><input type="checkbox" name="enabled" disabled={!transferApproved} defaultChecked={transferApproved && reviews.enabled} /> Включить автоматическую модерацию DeepSeek</label><SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить модерацию</SubmitButton>
      </form><p className="muted">Без подтверждения оператора или согласия покупателя — ручная проверка. ИИ не получает инструменты, не отвечает покупателю и не генерирует текст по его запросам. Низкая оценка разрешена; текст и оценка не изменяются.</p>
    </section>
  </div>;
}
