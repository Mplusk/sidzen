import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { claimRun, processRun } from "../src/lib/marketplaces/sync";
import { catalogInvalidationToken } from "../src/lib/marketplaces/cache-token";
import { cancelOzonJob, processOzonJob, refreshOzonJob, syncOzonPointsPage } from "../src/lib/delivery/ozon-worker";
import { pruneTransientPersonalData } from "../src/lib/privacy-maintenance";
import { reconcileTochkaPayments } from "../src/lib/payments";
import { processFiscalReceipt } from "../src/lib/cloudkassir/worker";
import { pruneDiagnosticLogs, writeDiagnostic } from "../src/lib/diagnostics";
import { pruneOrphanReviewPhotos } from "../src/lib/review-image-maintenance";
import { processCategoryAiJob } from "../src/lib/category-ai/worker";

let stopping = false;
let nextPrivacyCleanup = 0;
let nextPaymentCheck = 0;
let nextOAuthCleanup = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
async function heartbeat() { await writeFile("/tmp/3dprinta-marketplace-heartbeat", String(Date.now())); }
await heartbeat();
const pulse = setInterval(() => { void heartbeat().catch(() => {}); }, 10_000);
// Bank / fiscal work must not wait for a large marketplace import or carrier
// request. A separate awaited loop avoids overlapping ticks and drains safely
// before the shared database client is disconnected on shutdown.
async function financeLoop() {
  while (!stopping) {
    try {
      if (Date.now() >= nextPaymentCheck) {
        nextPaymentCheck = Date.now() + 60_000;
        await reconcileTochkaPayments(() => stopping).catch(async () => { await writeDiagnostic("payment.reconcile.failed"); });
      }
      if (!stopping) await processFiscalReceipt();
    } catch { await writeDiagnostic("fiscal.failed", { reason: "temporary" }); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
const finances = financeLoop();
// AI latency must not hold up imports, PVZ refresh, shipments or payments.
async function categoryAiLoop() {
  let dirty = true;
  while (!stopping) {
    try {
      dirty = await processCategoryAiJob() || dirty;
      if (dirty && !stopping) {
        const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
        const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
        if (response.ok) dirty = false;
      }
    } catch { await writeDiagnostic("category-ai.failed", { reason: "temporary" }); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
const categories = categoryAiLoop();
console.log("Marketplace, delivery and independent financial queues ready.");
try {
  while (!stopping) {
    try {
      if (Date.now() >= nextOAuthCleanup) {
        await prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
        nextOAuthCleanup = Date.now() + 60_000;
      }
      if (Date.now() >= nextPrivacyCleanup) {
        await pruneTransientPersonalData();
        await pruneDiagnosticLogs();
        await pruneOrphanReviewPhotos();
        nextPrivacyCleanup = Date.now() + 3600000;
      }
      const run = await claimRun();
      if (run) {
        await processRun(run);
        try {
          const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
          const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
          if (!response.ok) await writeDiagnostic("worker.cache");
        } catch { await writeDiagnostic("worker.cache"); }
        console.log("Marketplace job processed", run.id);
      }
      await cancelOzonJob();
      await processOzonJob();
      await refreshOzonJob();
      await syncOzonPointsPage();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      await writeDiagnostic("worker.failed");
      console.warn("Marketplace worker temporarily unavailable; retrying without losing queued jobs.");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
} finally { stopping = true; clearInterval(pulse); await Promise.all([finances, categories]); await prisma.$disconnect(); }
