// CLI-only: deliberately absent from the Next.js graph. Enumerating runtime
// data in a web module would make Turbopack trace the workspace into the image.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decryptSecret } from "./integration-secrets";
import { applyRestoredErasurePlan, erasurePlanSchema, ledgerDirectory } from "./privacy-erasure";
export async function replayErasureLedger() {
  const directory = ledgerDirectory();
  for (const name of (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json\.enc$/.test(name))) {
    const id = name.slice(0, -9);
    const plan = erasurePlanSchema.parse(JSON.parse(decryptSecret(await readFile(join(directory, name), "utf8"), `privacy-erasure:${id}`)));
    if (plan.id !== id) throw new Error("Erasure ledger identity mismatch");
    await applyRestoredErasurePlan(plan);
  }
}
