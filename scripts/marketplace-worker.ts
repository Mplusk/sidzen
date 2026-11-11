import { writeFile } from "node:fs/promises";
import { backfillCatalogFacets } from "../src/lib/catalog-facets-server";
import { prisma } from "../src/lib/prisma";
import { claimRun, processRun } from "../src/lib/marketplaces/sync";
import { catalogInvalidationToken } from "../src/lib/marketplaces/cache-token";
import { cancelOzonJob, processOzonJob, refreshOzonJob, syncOzonPointsPage } from "../src/lib/delivery/ozon-worker";
import { scheduleOzonDirectoryRefresh } from "../src/lib/delivery/ozon-directory-schedule";
import { processCdekJob } from "../src/lib/delivery/cdek-worker";
import { pruneTransientPersonalData } from "../src/lib/privacy-maintenance";
import { prunePersonalDataRetention } from "../src/lib/privacy-retention";
import { reconcileTochkaPayments } from "../src/lib/payments";
import { reconcileYooKassaPayments } from "../src/lib/yookassa/payments";
import { processYooKassaSettlement } from "../src/lib/yookassa/settlements";
import { processFiscalReceipt } from "../src/lib/cloudkassir/worker";
import { pruneDiagnosticLogs, writeDiagnostic } from "../src/lib/diagnostics";
import { pruneMonitoring } from "../src/lib/monitoring";
import { pruneOrphanReviewPhotos } from "../src/lib/review-image-maintenance";
import { processCategoryAiJob } from "../src/lib/category-ai/worker";
import { processReviewAiJob } from "../src/lib/review-ai/worker";
import { processTelegramOrder, processTelegramStatus } from "../src/lib/telegram/worker";
import { releaseExpiredStockHolds } from "../src/lib/stock-hold-expiration";

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
        await reconcileYooKassaPayments().catch(async () => { await writeDiagnostic("payment.reconcile.failed"); });
      }
      if (!stopping) await processFiscalReceipt();
      if (!stopping) await processYooKassaSettlement();
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
      dirty = await backfillCatalogFacets() || dirty;
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
async function communicationLoop(task: () => Promise<unknown>) {
  while (!stopping) {
    try { await task(); } catch { await writeDiagnostic("communications.failed"); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
let reviewCatalogDirty = false;
const reviews = communicationLoop(async () => {
  reviewCatalogDirty = await processReviewAiJob() || reviewCatalogDirty;
  if (reviewCatalogDirty) {
    const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
    const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    if (response.ok) reviewCatalogDirty = false;
  }
});
const telegram = communicationLoop(async () => { await processTelegramOrder(); await processTelegramStatus(); });
// Retention/file failures must not prevent carrier cancellations or imports.
async function privacyRetentionLoop() {
  let next = 0;
  while (!stopping) {
    if (Date.now() >= next) {
      try { await prunePersonalDataRetention(); next = Date.now() + 3600000; }
      catch { next = Date.now() + 60000; await writeDiagnostic("worker.failed"); }
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
const retention = privacyRetentionLoop();
// Public-directory refresh must not wait for a long marketplace import. One
// awaited loop handles both the nightly schedule and all pages of manual jobs.
async function pickupDirectoryLoop() {
  let nextScheduleCheck = 0;
  while (!stopping) {
    try {
      if (Date.now() >= nextScheduleCheck) {
        nextScheduleCheck = Date.now() + 60_000;
        await scheduleOzonDirectoryRefresh();
      }
      if (!stopping) await syncOzonPointsPage();
    } catch { await writeDiagnostic("delivery.points.failed", { stage: "points", reason: "temporary" }).catch(() => {}); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
const pickupDirectory = pickupDirectoryLoop();
// Reservations expire independently of slow carrier and marketplace work.
async function stockHoldLoop() {
  let dirty = false;
  while (!stopping) {
    try {
      dirty = await releaseExpiredStockHolds(prisma) || dirty;
      if (dirty) {
        const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
        const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
        if (response.ok) dirty = false;
      }
    } catch { await writeDiagnostic("worker.failed"); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 10_000));
  }
}
const stockHolds = stockHoldLoop();
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
        await pruneMonitoring();
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
      await processCdekJob();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      await writeDiagnostic("worker.failed");
      console.warn("Marketplace worker temporarily unavailable; retrying without losing queued jobs.");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
} finally { stopping = true; clearInterval(pulse); await Promise.all([finances, categories, reviews, telegram, retention, pickupDirectory, stockHolds]); await prisma.$disconnect(); }
