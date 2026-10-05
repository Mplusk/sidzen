import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { diagnosticEvents, safeDiagnosticDetails, type DiagnosticCode, type DiagnosticDetails } from "./diagnostic-events";

export const LOG_RETENTION_DAYS = 30;
export const LOG_MAX_ROWS = 10_000;
// Serializes inserts and clear-all: clearing removes rows committed before it,
// while genuinely new events after clearing are retained.
export const LOG_LOCK = 73412029;
export async function writeDiagnostic(code: DiagnosticCode, details: DiagnosticDetails = {}): Promise<string | null> {
  try {
    const event = Object.hasOwn(diagnosticEvents, code) ? diagnosticEvents[code] : null;
    if (!event) return null;
    const reference = randomUUID();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOG_LOCK})`;
      await tx.diagnosticLog.create({ data: { reference, area: event[0], level: event[1], code, details: safeDiagnosticDetails(details) } });
      const boundary = await tx.diagnosticLog.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: LOG_MAX_ROWS - 1, select: { id: true, createdAt: true } });
      if (boundary) await tx.diagnosticLog.deleteMany({ where: { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } });
    }, { maxWait: 1000, timeout: 3000 });
    return reference;
  } catch {
    // Diagnostics must never prevent checkout, money reconciliation or retries.
    // Do not print the exception: it may contain SQL, arguments or credentials.
    console.warn("Diagnostic event could not be stored; no request data logged.");
    return null;
  }
}
export async function pruneDiagnosticLogs(now = new Date()) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOG_LOCK})`;
    await tx.diagnosticLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - LOG_RETENTION_DAYS * 86400000) } } });
  });
}
