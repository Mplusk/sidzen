import Link from "next/link";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`logo${inverse ? " logo--inverse" : ""}`} href="/" aria-label="3DPRINTA — на главную">
      <span className="logo__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>3DPRINTA</span>
    </Link>
  );
}
