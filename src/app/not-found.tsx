import Link from "next/link";

export default function NotFound() { return <div className="container error-page"><div><strong>404</strong><h1 style={{ fontSize: "2.8rem" }}>Такой страницы нет</h1><p>Возможно, адрес изменился. Старые адреса мы перенаправляем автоматически, если знаем новый.</p><Link className="button" href="/">На главную</Link></div></div>; }
