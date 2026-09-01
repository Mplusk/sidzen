import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Мои модели", robots: { index: false, follow: false } };

export default async function ModelsPage() {
  const user = await requireUser();
  const models = await prisma.customerModelFile.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "desc" } });
  return <><span className="eyebrow">Закрытое хранилище</span><h1>Мои модели</h1><p className="muted">Файлы не публикуются и скачиваются только после проверки прав.</p>{models.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Файл</th><th>Дата</th><th>Габариты</th><th>Объём</th><th>Статус</th><th /></tr></thead><tbody>{models.map((model) => <tr key={model.id}><td><strong>{model.originalName}</strong></td><td>{formatDate(model.createdAt)}</td><td>{[model.widthMm, model.depthMm, model.heightMm].map((value) => value ? Number(value) : "—").join(" × ")} мм</td><td>{model.volumeCm3 ? `${Number(model.volumeCm3)} см³` : "—"}</td><td><span className="status">{model.status === "ANALYZED" ? "Проверена" : "На проверке"}</span></td><td><a className="text-link" href={`/api/model/${model.id}/download`}>Скачать</a></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>Моделей пока нет</h3><Link className="button" href="/print/">Загрузить модель</Link></div>}</>;
}
