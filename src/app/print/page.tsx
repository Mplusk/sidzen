import type { Metadata } from "next";
import Image from "next/image";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ModelConfigurator } from "@/components/model-configurator";
import { prisma } from "@/lib/prisma";
import { CheckIcon, ShieldIcon, UploadIcon } from "@/components/icons";

export const metadata: Metadata = { title: "3D-печать по вашей модели — расчёт онлайн", description: "Загрузите STL или OBJ, выберите PLA, PETG, ABS или Nylon и получите предварительную стоимость 3D-печати.", alternates: { canonical: "/print/" } };

export default async function PrintPage() {
  const [materialsRaw, qualitiesRaw, postRaw, minimumRule, setupRule] = await Promise.all([
    prisma.material.findMany({ where: { active: true }, include: { colors: { where: { active: true } } }, orderBy: { name: "asc" } }),
    prisma.qualityProfile.findMany({ where: { active: true }, orderBy: { layerHeightMm: "desc" } }),
    prisma.postProcessOption.findMany({ where: { active: true }, orderBy: { price: "asc" } }),
    prisma.priceRule.findUnique({ where: { code: "minimum_order" } }),
    prisma.priceRule.findUnique({ where: { code: "setup_fee" } }),
  ]);
  const materials = materialsRaw.map((item) => ({ slug: item.slug, name: item.name, density: Number(item.density), pricePerGram: Number(item.pricePerGram), colors: item.colors.map((color) => ({ slug: color.slug, name: color.name, hex: color.hex })) }));
  const qualities = qualitiesRaw.map((item) => ({ slug: item.slug, name: item.name, layerHeightMm: Number(item.layerHeightMm), priceMultiplier: Number(item.priceMultiplier) }));
  const postProcesses = postRaw.map((item) => ({ slug: item.slug, name: item.name, price: Number(item.price) }));
  return (
    <>
      <div className="container"><Breadcrumbs items={[{ label: "Печать по модели" }]} /></div>
      <section className="container print-hero"><div><span className="eyebrow">Custom print</span><h1>Ваша модель. Наше производство.</h1><p>Загрузите файл, выберите параметры и сразу увидите ориентир по весу, времени и цене. Финал подтверждает оператор после проверки технологичности.</p><div className="print-benefits"><div className="print-benefit"><UploadIcon /><strong>До 100 МБ</strong><span>STL, OBJ, 3MF, STEP</span></div><div className="print-benefit"><ShieldIcon /><strong>Закрытое хранение</strong><span>Без публичных ссылок</span></div><div className="print-benefit"><CheckIcon /><strong>Проверка сетки</strong><span>Габарит и объём</span></div></div></div><div className="print-visual"><Image src="/generated/product-custom-print.webp" alt="Процесс печати детали по модели клиента" fill priority sizes="(max-width: 820px) 100vw, 50vw" /></div></section>
      <section className="section section--white"><div className="container"><ModelConfigurator materials={materials} qualities={qualities} postProcesses={postProcesses} minimumOrder={Number(minimumRule?.value) || 650} setupFee={Number(setupRule?.value) || 250} /></div></section>
      <section className="section"><div className="container"><div className="section-heading"><div><span className="eyebrow">Что проверяем</span><h2>Автоматическая оценка не заменяет инженера</h2></div><p>Если сетка незамкнута или формат требует конвертации, заявка всё равно сохранится и попадёт оператору.</p></div><div className="content-grid"><div className="content-card"><span className="content-card__number">01</span><h3>Геометрия</h3><p>Размеры, объём, замкнутость mesh и единицы измерения.</p></div><div className="content-card"><span className="content-card__number">02</span><h3>Технологичность</h3><p>Минимальная стенка, нависания, поддержка и ориентация детали.</p></div><div className="content-card"><span className="content-card__number">03</span><h3>Согласование</h3><p>Материал, допуск, поверхность, цена и реальный срок производства.</p></div></div></div></section>
    </>
  );
}
