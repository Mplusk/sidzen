// Run ONLY offline, after restoring the database and managed files, before
// starting app/worker/proxy. The independent ledger must NOT be rolled back.
import { replayErasureLedger } from "../src/lib/privacy-erasure-restore";
import { prisma } from "../src/lib/prisma";
if (!process.argv.includes("--confirm-offline-restore")) throw new Error("Offline restoration confirmation is required");
try { await replayErasureLedger(); console.log("Privacy tombstones replayed; managed file removal verified."); }
finally { await prisma.$disconnect(); }
