import type { Metadata } from "next";
export const metadata: Metadata = { title: "404 — страница не найдена", robots: { index: false, follow: true } };
import Link from "next/link";

export default function NotFound() { return <div className="container error-page"><div><strong>404</strong><h1 style={{ fontSize: "2.8rem" }}>Такой страницы нет</h1><p>Перейдите в каталог и выберите нужный товар.</p><Link className="button" href="/catalog/">Открыть каталог</Link></div></div>; }
