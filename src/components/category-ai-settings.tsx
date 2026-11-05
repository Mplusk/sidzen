import { getCategoryAiConfig } from "@/lib/category-ai/config";
import { saveCategoryAiConfig } from "@/app/actions/category-ai";
import { SubmitButton } from "@/components/submit-button";

export async function CategoryAiSettings() {
  const config = await getCategoryAiConfig();
  return <section className="content-card" id="category-ai"><h2>DeepSeek · категории товаров</h2>
    <p>После включения новые товары, в том числе из Ozon и WB, получают категорию в фоне. ИИ сначала выбирает существующую категорию; если подходящей нет, может создать новую. Старые товары автоматически не меняются. Ручной выбор защищён от ИИ и повторного импорта.</p>
    <p className="muted">Передаются только название, описание товара и названия категорий. Не указывайте персональные или конфиденциальные данные в описаниях. Данные клиентов, заказов, себестоимость и фотографии не передаются. Запросы категоризации оплачиваются по тарифу вашего DeepSeek API.</p>
    <form action={saveCategoryAiConfig} className="form-grid" autoComplete="off">
      <input type="hidden" name="revision" value={config.revision} />
      <label className="field">DeepSeek API key<input type="password" name="apiKey" autoComplete="new-password" maxLength={512} placeholder={config.apiKey ? "Ключ сохранён; пустое поле оставит его прежним" : "sk-…"} /><small>Ключ хранится зашифрованным и не передаётся браузеру.</small></label>
      <label className="field">Модель<select name="model" defaultValue={config.model}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
      <label><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Автоматически определять категории новых товаров</label>
      <label><input type="checkbox" name="allowCreate" defaultChecked={config.allowCreate} /> Создавать новую категорию, если подходящей нет</label>
      <label className="field--full"><input type="checkbox" name="clearKey" /> Удалить сохранённый ключ (сначала выключите автоматическую категоризацию)</label>
      <div className="form-actions"><SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton>
      <SubmitButton className="button button--outline" name="verify" value="yes" pendingLabel="Проверяем…">Проверить и сохранить</SubmitButton></div>
</form>
    {config.checkedAt && <p className="muted">Доступ к модели проверен: {new Date(config.checkedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК. Проверка ключа не генерирует текст и не создаёт категории.</p>}
    <p><a className="text-link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">Получить ключ DeepSeek →</a></p>
  </section>;
}
