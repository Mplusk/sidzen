import { saveYandexMapsSettings } from "@/app/actions/yandex-maps";
import { SubmitButton } from "@/components/submit-button";
import { getYandexMapsConfig } from "@/lib/yandex-maps/config";

export async function YandexMapsSettings() {
  const config = await getYandexMapsConfig();
  return <section className="content-card" id="yandex-maps">
    <h2>Яндекс Карты · пункты выдачи</h2>
    <p>Ключ JavaScript API создаётся в <a className="text-link" href="https://developer.tech.yandex.ru/" target="_blank" rel="noreferrer">кабинете Яндекса</a>. Выберите бесплатное использование и ограничьте ключ доменом sidzen.shop. Яндекс Карты загружаются после согласия покупателя; без согласия доступна обычная карта.</p>
    <form action={saveYandexMapsSettings} className="form-grid" autoComplete="off">
      <input type="hidden" name="revision" value={config.revision} />
      <label className="field">Ключ JavaScript API<input name="apiKey" type="password" autoComplete="new-password" maxLength={128} placeholder={config.apiKey ? "Сохранён; пустое поле оставит прежний ключ" : "Ключ из кабинета Яндекса"} /><small>Ключ хранится зашифрованным и передаётся браузеру при загрузке карты; ограничьте его доменом.</small></label>
      {config.apiKey && <label><input type="checkbox" name="clearKey" /> Удалить ключ и отключить Яндекс Карты</label>}
      <div className="form-actions"><SubmitButton className="button" pendingLabel="Сохраняем…">Сохранить</SubmitButton></div>
    </form>
  </section>;
}
