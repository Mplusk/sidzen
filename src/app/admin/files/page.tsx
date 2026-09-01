import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Файлы моделей", robots: { index: false, follow: false } };

export default async function FilesPage() {
  const files = await prisma.customerModelFile.findMany({ include: { owner: true, orderItems: { include: { order: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return <><div className="admin-header"><div><span className="eyebrow">Закрытое хранилище</span><h1>Модели клиентов</h1></div></div><p className="notice">Файлы не лежат в публичном CDN. Ссылка ниже проходит проверку роли и не кешируется.</p><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Файл</th><th>Владелец</th><th>Дата</th><th>Габариты</th><th>Сетка</th><th>Заказ</th><th /></tr></thead><tbody>{files.map((file) => <tr key={file.id}><td><strong>{file.originalName}</strong><br /><small>{file.extension.toUpperCase()} · {(Number(file.sizeBytes) / 1024 / 1024).toFixed(1)} МБ</small></td><td>{file.owner?.email ?? "Гость"}</td><td>{formatDate(file.createdAt)}</td><td>{[file.widthMm, file.depthMm, file.heightMm].map((value) => value ? Number(value) : "—").join(" × ")}</td><td>{file.watertight == null ? "ручная проверка" : file.watertight ? "замкнута" : "проблема"}</td><td>{file.orderItems[0]?.order.number ?? "—"}</td><td><a className="text-link" href={`/api/model/${file.id}/download`}>Скачать</a></td></tr>)}</tbody></table></div></>;
}
