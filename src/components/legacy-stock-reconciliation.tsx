import Link from "next/link";
import { confirmLegacyStockAction } from "@/app/actions/stock-reconciliation";
import { SubmitButton } from "@/components/submit-button";

export function LegacyStockReconciliation({ orderId, number, products, canEditProducts, reviewSnapshot }: { orderId: string; number: string; products: { id: string; name: string; sku: string; stock: number; reservedStock: number; quantity: number }[]; canEditProducts: boolean; reviewSnapshot: string }) {
  return <section className="admin-card">
    <h2>Сверка остатков старого заказа</h2>
    <p className="notice">Продажа связанных товаров приостановлена до сверки всех старых заказов. Для этого заказа сайт не создавал резерв и не спишет товар автоматически.</p>
    <ol>
      <li>Сверьте статус оплаты и доставки этого заказа, чтобы понять, какие товары уже отгружены, возвращены или ещё нужны покупателю.</li>
      <li>Пересчитайте товар на складе. Если фактический остаток неизвестен, сначала выясните его и не подтверждайте сверку.</li>
      <li>При необходимости исправьте остаток в карточке товара. Не включайте в него уже отгруженные товары или товары, выделенные для этого заказа. Резервы новых заказов вручную повторно не вычитайте.</li>
      <li>Проверьте все старые заказы с этим товаром по артикулу и подтвердите сверку каждого отдельно.</li>
    </ol>
    {products.length > 0 ? <ul>{products.map(product => <li key={product.id}><strong>{product.name}</strong> · {product.sku}<br />В этом заказе: {product.quantity} шт. · Остаток в системе: {product.stock} шт. · Резерв новых заказов: {product.reservedStock} шт.{canEditProducts && <> · <Link className="text-link" href={`/admin/products/${product.id}/`}>Открыть карточку товара</Link></>} · <Link className="text-link" href={`/admin/orders/?view=stock-review&q=${encodeURIComponent(product.sku)}`}>Все старые заказы с этим артикулом</Link></li>)}</ul> : <p>Связанных товаров в каталоге больше нет.</p>}
    <form action={confirmLegacyStockAction} className="form-grid">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="reviewSnapshot" value={reviewSnapshot} />
      <input type="hidden" name="products" value={JSON.stringify(products.map(({ id, stock, reservedStock }) => ({ id, stock, reservedStock })))} />
      <label className="field field--full">Что проверено<textarea name="reason" required minLength={10} maxLength={500} placeholder="Например: проверены отгрузка и фактический остаток на складе" /></label>
      <label className="field field--full">Введите номер заказа {number}<input name="confirmation" autoComplete="off" maxLength={100} required /></label>
      <label className="field--full"><input type="checkbox" name="reviewed" required /> Я сверил все позиции: остаток учитывает товары, недоступные для продажи по этому заказу, а возвращённые товары находятся на складе. Повторного вычета нет.</label>
      <SubmitButton className="button button--small" pendingLabel="Сохраняем…">Подтвердить сверку</SubmitButton>
    </form>
  </section>;
}

