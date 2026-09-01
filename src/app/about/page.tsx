import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata: Metadata = { title: "О производстве", description: "Как 3DPRINTA проверяет модели, подбирает материал и контролирует производство изделий.", alternates: { canonical: "/about/" } };

export default function AboutPage() {
  return <><div className="container"><Breadcrumbs items={[{ label: "О производстве" }]} /></div><section className="container print-hero"><div><span className="eyebrow">3DPRINTA</span><h1>Инженерный подход к каждой детали</h1><p>Мы не скрываем ограничения 3D-печати: проверяем стенки, посадки, ориентацию слоёв и условия эксплуатации до запуска.</p><Link className="button" href="/print/">Обсудить модель</Link></div><div className="print-visual"><Image src="/generated/hero-studio.webp" alt="Готовые изделия производства 3DPRINTA" fill sizes="50vw" /></div></section><section className="section section--white"><div className="container content-grid"><div className="content-card"><span className="content-card__number">01</span><h3>Проверяем</h3><p>Геометрию, сетку, габарит, минимальную стенку и допуски.</p></div><div className="content-card"><span className="content-card__number">02</span><h3>Согласуем</h3><p>Материал, цвет, слой, заполнение, поверхность, срок и цену.</p></div><div className="content-card"><span className="content-card__number">03</span><h3>Контролируем</h3><p>Первый слой, стабильность процесса, размеры и внешний вид после печати.</p></div></div></section></>;
}
