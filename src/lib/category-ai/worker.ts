import { randomUUID, createHash } from "node:crypto";
import type { Prisma, ProductCategoryAiJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getCategoryAiConfig, categoryAiReady } from "./config";
import { classifyProduct, categoryNameKey, aiCategorySlug, CategoryAiError, type AiProduct, type CategoryDecision } from "./client";

const lock = async (tx: Prisma.TransactionClient) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`; };
const fingerprint = (product: AiProduct) => createHash("sha256").update(JSON.stringify([product.name, product.shortDescription, product.description])).digest("hex");
export function categoryAiLeaseMatches(current: ProductCategoryAiJob | null, job: ProductCategoryAiJob) {
  return current?.status === "RUNNING" && current.generation === job.generation && current.leaseToken === job.leaseToken && Boolean(current.leaseUntil && current.leaseUntil > new Date());
}
export async function claimCategoryAiJob() {
  return prisma.$transaction(async tx => {
    await lock(tx);
    // Imports own the same short lock. Wait for the complete canonical text.
    if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) return null;
    const now = new Date();
    const job = await tx.productCategoryAiJob.findFirst({ where: { OR: [
      { status: "PENDING", availableAt: { lte: now } },
      { status: "RUNNING", leaseUntil: { lte: now } },
    ] }, orderBy: { availableAt: "asc" } });
    if (!job) return null;
    if (job.attempts >= 3) { await tx.productCategoryAiJob.update({ where: { productId: job.productId }, data: { status: "FAILED", errorCode: "transport", leaseToken: null, leaseUntil: null } }); return null; }
    return tx.productCategoryAiJob.update({ where: { productId: job.productId }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120_000) } });
  });
}

export async function applyCategoryDecision(job: ProductCategoryAiJob, decision: CategoryDecision, productFingerprint: string, revision: string) {
  return prisma.$transaction(async tx => {
    await lock(tx);
    const current = await tx.productCategoryAiJob.findUnique({ where: { productId: job.productId } });
    if (!categoryAiLeaseMatches(current, job)) return false;
    const product = await tx.product.findUnique({ where: { id: job.productId } });
    const config = await getCategoryAiConfig(tx);
    if (!product || product.categoryMode !== "AI" || !categoryAiReady(config)) {
      await tx.productCategoryAiJob.update({ where: { productId: job.productId }, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return false;
    }
    if (config.revision !== revision || fingerprint(product) !== productFingerprint) {
      await tx.productCategoryAiJob.update({ where: { productId: job.productId }, data: { status: "PENDING", attempts: 0, generation: { increment: 1 }, availableAt: new Date(), leaseToken: null, leaseUntil: null } }); return false;
    }
    let category;
    let created = false;
    if (decision.kind === "existing") category = await tx.category.findUnique({ where: { id: decision.categoryId } });
    else {
      if (!config.allowCreate) throw new CategoryAiError("response");
      // Recheck after the HTTP call: another job/admin may have created it.
      const all = await tx.category.findMany();
      category = all.find(item => categoryNameKey(item.name) === categoryNameKey(decision.name));
      if (!category) {
        category = await tx.category.create({ data: { name: decision.name, slug: aiCategorySlug(decision.name), title: decision.name, h1: decision.name } });
        created = true;
      }
    }
    if (!category?.visible) throw new CategoryAiError("no-category");
    await tx.productCategory.deleteMany({ where: { productId: job.productId, isPrimary: true, categoryId: { not: category.id } } });
    await tx.productCategory.upsert({ where: { productId_categoryId: { productId: job.productId, categoryId: category.id } }, create: { productId: job.productId, categoryId: category.id, isPrimary: true }, update: { isPrimary: true } });
    await tx.productCategoryAiJob.update({ where: { productId: job.productId }, data: { status: "DONE", errorCode: null, leaseToken: null, leaseUntil: null } });
    await tx.auditLog.create({ data: { action: "product.category.ai", entityType: "Product", entityId: job.productId, after: { categoryId: category.id, categoryCreated: created, model: config.model } } });
    return true;
  });
}
export async function processCategoryAiJob(transport: typeof fetch = fetch) {
  const config = await getCategoryAiConfig();
  if (!categoryAiReady(config)) return false;
  const job = await claimCategoryAiJob();
  if (!job) return false;
  try {
    const product = await prisma.product.findUnique({ where: { id: job.productId } });
    if (!product || product.categoryMode !== "AI") {
      await prisma.productCategoryAiJob.updateMany({ where: { productId: job.productId, leaseToken: job.leaseToken, generation: job.generation }, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return false;
    }
    const categories = await prisma.category.findMany({ select: { id: true, name: true, parentId: true, visible: true }, orderBy: { id: "asc" }, take: 501 });
    // Do not hide invisible categories from duplicate checking. If AI chooses
    // one, apply refuses it; an invisible category must never be resurrected.
    const decision = await classifyProduct(config, product, categories, transport);
    const changed = await applyCategoryDecision(job, decision, fingerprint(product), config.revision);
    if (changed) await writeDiagnostic("category-ai.ok", { attempts: job.attempts });
    return changed;
  } catch (error) {
    const safe = error instanceof CategoryAiError ? error : new CategoryAiError("response");
    const pending = safe.retryable && job.attempts < 3;
    const result = await prisma.productCategoryAiJob.updateMany({ where: { productId: job.productId, status: "RUNNING", generation: job.generation, leaseToken: job.leaseToken }, data: { status: pending ? "PENDING" : "FAILED", errorCode: safe.code, availableAt: new Date(Date.now() + job.attempts * 30_000), leaseToken: null, leaseUntil: null } });
    if (result.count) await writeDiagnostic("category-ai.failed", { aiFailure: safe.code, attempts: job.attempts });
    return false;
  }
}
export const categoryAiJobMessages: Record<string, string> = {
  PENDING: "Ожидает категоризации DeepSeek. Обновите страницу после обработки.",
  RUNNING: "DeepSeek определяет категорию. Обновите страницу через несколько секунд.",
  DONE: "Категория определена DeepSeek. Можно сменить её вручную.",
  CANCELED: "ИИ-категоризация отменена. Категорию можно выбрать вручную.",
};
export const categoryAiErrorMessages: Record<string, string> = {
  credentials: "DeepSeek отклонил ключ. Проверьте его в подключениях магазина.",
  rate: "DeepSeek ограничил запросы. Проверьте баланс и лимиты, затем повторите категоризацию.",
  transport: "DeepSeek не ответил после повторов. Можно повторить или выбрать категорию вручную.",
  provider: "DeepSeek отклонил запрос. Проверьте подключение и баланс API.",
  response: "DeepSeek вернул некорректный ответ. Данные товара сохранены, выберите категорию или повторите.",
  catalog: "Слишком много категорий для безопасной автоматической обработки (максимум 500). Выберите вручную.",
  "no-category": "Подходящая доступная категория не найдена. Выберите вручную или разрешите создание новых категорий.",
};
