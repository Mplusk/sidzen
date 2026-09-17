import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Материалы для 3D-печати", description: "Сравнение PLA, PETG, ABS и Nylon: свойства, температура, цена и применение.", alternates: { canonical: "/materials/" } };

export default async function MaterialsPage() {
  const materials = await prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return <><div className="container"><Breadcrumbs items={[{ label: "Материалы" }]} /></div><header className="page-hero page-hero--compact"><div className="container"><span className="eyebrow">Справочник</span><h1>Материал определяет поведение детали</h1><p>Сравните термостойкость, прочность, внешний вид и стоимость до оформления.</p></div></header><section className="section"><div className="container material-grid">{materials.map((material, index) => <Link href={`/materials/${material.slug}/`} className="material-card" style={{ "--material-color": ["#ff6a2a", "#285de8", "#2f7354", "#7255bd"][index % 4] } as React.CSSProperties} key={material.id}><span className="material-card__code">{material.name}</span><h3>{material.type}</h3><p>{material.description}</p><ul><li>{material.advantages}</li><li>{material.temperature}</li></ul></Link>)}</div></section><section className="section section--white"><div className="container rich-text"><h2>Как выбрать материал</h2><p>Для интерьерной детали обычно достаточно PLA. Для крепления, корпуса или изделия рядом с водой чаще подходит PETG. ABS и Nylon выбирают, когда важны температура, ударная нагрузка или износ. Проверьте ограничения материала в карточке изделия.</p></div></section></>;
}
