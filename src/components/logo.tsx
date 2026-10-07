import Link from "next/link";
import Image from "next/image";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`logo${inverse ? " logo--inverse" : ""}`} href="/catalog/" aria-label="SIDZEN — 3D декор для дома, открыть каталог">
      <Image src={`/brand/sidzen-logo${inverse ? "-inverse" : ""}.svg`} alt="SIDZEN · 3D декор для дома" width={186} height={60} unoptimized priority={!inverse} />
    </Link>
  );
}
