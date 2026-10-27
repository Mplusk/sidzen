import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

// Exercise the actual migration against legacy data inside a rolled-back QA
// transaction. Never run data-mutating fixtures against the live shop.
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const sql = (await readFile(new URL("../prisma/migrations/20261027090000_retire_manufacturing_options/migration.sql", import.meta.url), "utf8")).replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
const rollback = new Error("QA rollback");
let verified = false;
try {
  await prisma.$transaction(async tx => {
    const prefix = `qa-retired-${randomUUID()}`;
    const technology = await tx.technology.create({ data: { name: prefix, slug: prefix } });
    const quality = await tx.qualityProfile.create({ data: { name: prefix, slug: prefix, layerHeightMm: ".12", priceMultiplier: 2 } });
    const finishing = await tx.postProcessOption.create({ data: { name: prefix, slug: prefix, price: 1200 } });
    const product = await tx.product.create({ data: { name: prefix, sku: prefix, slug: prefix, basePrice: 240,
      technologies: { connect: { id: technology.id } }, qualityProfiles: { connect: { id: quality.id } }, postProcesses: { connect: { id: finishing.id } },
      variants: { create: { sku: `${prefix}-fine`, qualityProfileId: quality.id, price: 480 } },
    }, include: { variants: true } });
    const config = { material: "pla", color: "white", quality: "fine", qualityName: "Fine", technology: "fdm", postProcesses: ["painting"] };
    const cart = await tx.cart.create({ data: { sessionKey: prefix, items: { create: [
      { productId: product.id, variantId: product.variants[0].id, unitPrice: 480, config },
      { productId: product.id, unitPrice: 240, config: Prisma.JsonNull },
    ] } } });
    const order = await tx.order.create({ data: { number: prefix, customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+70000000000", subtotal: 960, total: 960,
      items: { create: { productId: product.id, productName: prefix, quantity: 2, unitPrice: 480, totalPrice: 960, configuration: config, technologyId: technology.id, qualityProfileId: quality.id } },
    }, include: { items: true } });
    const before = JSON.stringify(order);
    await tx.auditLog.deleteMany({ where: { id: "manufacturing-options-retired-20261027" } });
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    const current = await tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { technologies: true, qualityProfiles: true, postProcesses: true } });
    assert.equal(current.technologies.length + current.qualityProfiles.length + current.postProcesses.length, 0);
    assert.equal(Number(current.basePrice), 240);
    const items = await tx.cartItem.findMany({ where: { cartId: cart.id } });
    assert.deepEqual(items.find(item => item.config)?.config, { material: "pla", color: "white" });
    assert(items.every(item => item.variantId === null));
    assert.equal(JSON.stringify(await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } })), before, "Historical order, configuration, relations and financial amounts must remain byte-for-byte unchanged");
    assert.equal((await tx.qualityProfile.findUniqueOrThrow({ where: { id: quality.id } })).active, false);
    assert.equal((await tx.technology.findUniqueOrThrow({ where: { id: technology.id } })).active, false);
    assert.equal((await tx.postProcessOption.findUniqueOrThrow({ where: { id: finishing.id } })).active, false);
    verified = true;
    throw rollback;
  }, { timeout: 30000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await prisma.$disconnect();
}
assert(verified);
console.log("PASS retired manufacturing migration: current choices disconnected/deactivated, legacy carts cleaned, JSON null tolerated, historical order JSON/foreign keys/amounts unchanged. All fixtures rolled back.");
