import Link from "next/link";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`logo${inverse ? " logo--inverse" : ""}`} href="/catalog/" aria-label="3DPRINTA — открыть каталог">
      <span className="logo__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>3DPRINTA</span>
    </Link>
  );
}
