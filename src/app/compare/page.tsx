import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Сравнение товаров", robots: { index: false, follow: true } };
export default function ComparePage() { return <div className="container prose-page"><span className="eyebrow">Сравнение</span><h1>Список сравнения пуст</h1><p>Добавьте товары из каталога. Параметры материалов и технологий можно сравнить прямо сейчас в справочнике.</p><Link className="button" href="/catalog/">Открыть каталог</Link></div>; }
