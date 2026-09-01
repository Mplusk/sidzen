import { notFound, permanentRedirect, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function LegacyRedirectPage({ params }: { params: Promise<{ legacy: string[] }> }) {
  const { legacy } = await params;
  const path = `/${legacy.join("/")}/`;
  const rule = await prisma.redirect.findUnique({ where: { fromPath: path } });
  if (!rule?.active) notFound();
  if (rule.code === 301) permanentRedirect(rule.toPath);
  redirect(rule.toPath);
}
