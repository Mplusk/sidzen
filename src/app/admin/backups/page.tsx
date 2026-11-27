import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { BackupRestore } from "@/components/backup-restore";

export const metadata: Metadata = { title: "Резервные копии", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const user = await requirePermission("settings.write", "/admin/backups/");
  if (!user.roles.includes("superadmin")) redirect("/account/?error=forbidden");
  return <>
    <div className="admin-header"><h1>Резервные копии</h1></div>
    <section className="content-card"><h2>Восстановление из Яндекс Диска</h2><BackupRestore /></section>
  </>;
}
