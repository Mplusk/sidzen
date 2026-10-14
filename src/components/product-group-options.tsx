import Image from "next/image";
import Link from "next/link";

export type GroupOption = { id: string; name: string; label: string; href: string; image: string | null };
export function ProductGroupOptions({ options, currentId }: { options: GroupOption[]; currentId: string }) {
  if (options.length < 2) return null;
  const current = options.find(option => option.id === currentId);
  return <section className="product-group-options" aria-label="Варианты товара">
    <p>Вариант: <strong>{current?.label}</strong></p>
    <div className="product-group-options__items">{options.map(option => <Link key={option.id} href={option.href} className={`product-group-option${option.id === currentId ? " product-group-option--selected" : ""}`} aria-current={option.id === currentId ? "page" : undefined} aria-label={`${option.label} — ${option.name}`} title={option.label}>
      {option.image ? <Image src={option.image} alt={option.label} width={76} height={100} sizes="76px" loading="lazy" /> : <span>{option.label}</span>}
      <small>{option.label}</small>
    </Link>)}</div>
  </section>;
}
