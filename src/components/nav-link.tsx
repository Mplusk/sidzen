"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

export function NavLink({ href, children, exact, ...props }: ComponentProps<typeof Link> & { href: string; exact?: boolean }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const target = href.replace(/\/$/, "") || "/";
  const sectionRoot = exact ?? (target === "/account" || target === "/admin");
  const active = pathname === target || (!sectionRoot && pathname.startsWith(`${target}/`));
  return <Link {...props} href={href} aria-current={active ? "page" : undefined}>{children}</Link>;
}
