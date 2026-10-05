import { writeFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { claimRun, processRun } from "../src/lib/marketplaces/sync";
import { catalogInvalidationToken } from "../src/lib/marketplaces/cache-token";
import { processOzonJob, refreshOzonJob, syncOzonPointsPage } from "../src/lib/delivery/ozon-worker";
import { pruneTransientPersonalData } from "../src/lib/privacy-maintenance";
import { reconcileTochkaPayments } from "../src/lib/payments";
import { processFiscalReceipt } from "../src/lib/cloudkassir/worker";

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
        await reconcileTochkaPayments(() => stopping).catch(() => console.warn("Payment reconciliation will retry; no payment data logged."));
      }
      if (!stopping) await processFiscalReceipt();
    } catch { console.warn("Fiscal reconciliation will retry; no receipt or customer data logged."); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
const finances = financeLoop();
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
        nextPrivacyCleanup = Date.now() + 3600000;
      }
      const run = await claimRun();
      if (run) {
        await processRun(run);
        try {
          const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
          const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
          if (!response.ok) console.warn("Catalog cache will refresh using its normal TTL.");
        } catch { console.warn("Catalog cache will refresh using its normal TTL."); }
        console.log("Marketplace job processed", run.id);
      }
      await processOzonJob();
      await refreshOzonJob();
      await syncOzonPointsPage();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      console.warn("Marketplace worker temporarily unavailable; retrying without losing queued jobs.");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
} finally { stopping = true; clearInterval(pulse); await finances; await prisma.$disconnect(); }
