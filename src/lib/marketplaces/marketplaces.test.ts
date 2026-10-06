import { describe, expect, it, vi } from "vitest";
import { apiJson, fetchPage, fetchWbPrices } from "./api";
import { canonicalSnapshot, identityKeys, normalizeSku, type Connection, type Snapshot } from "./model";
import { imageExtension, safeImageUrl, importImages } from "./images";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { servedProductImageName, storedProductImageName } from "../product-admin";

const connection: Connection = { accountId: "1", clientId: "1", name: "Fixture", secret: "never-log-me", checkedAt: "2026-10-03" };
const snapshot: Snapshot = { externalId: "1", sku: "ITEM-1", name: "Ozon title", price: 150, oldPrice: 200, barcodes: ["000123"], description: "Ozon description", specifications: { "Цвет": "Белый" }, images: ["/uploads/products/a.jpg"], issue: null };
const json = (value: unknown, status = 200) => Response.json(value, { status });

describe("marketplace catalog contracts", () => {
  it("normalizes identities without removing meaningful punctuation or leading zeroes", () => {
    expect(normalizeSku("  Ａбв  01  ")).toBe("AБВ 01");
    expect(identityKeys({ sku: " item-1 ", barcodes: ["000123", " 000123 "] })).toEqual(["sku:ITEM-1", "barcode:000123"]);
    expect(normalizeSku("a-b")).not.toBe(normalizeSku("ab"));
  });
  it("is independent of import order and has a deterministic optional-field fallback", () => {
    const ozon = { provider: "ozon", externalId: "1", conflict: null, snapshot: { ...snapshot, description: null } };
    const wb = { provider: "wb", externalId: "2", conflict: null, snapshot: { ...snapshot, name: "WB title", price: 190, description: "WB description" } };
    expect(canonicalSnapshot([ozon, wb], "ozon")).toEqual(canonicalSnapshot([wb, ozon], "ozon"));
    expect(canonicalSnapshot([wb, ozon], "ozon")).toMatchObject({ name: "Ozon title", price: 150, description: "WB description" });
    expect(canonicalSnapshot([ozon, wb], "wb")).toMatchObject({ name: "WB title", price: 190 });
    expect(canonicalSnapshot([{ ...ozon, conflict: "identifiers" }, wb], "ozon")?.name).toBe("WB title");
  });
  it("rejects unsafe image hosts, redirects credentials, HTML and SVG", () => {
    expect(safeImageUrl("https://ir.ozone.ru/a.jpg", "ozon")).toBe(true);
    expect(safeImageUrl("https://basket-01.wbbasket.ru/a.jpg", "wb")).toBe(true);
    for (const value of ["http://ir.ozone.ru/a.jpg", "https://ir.ozone.ru.attacker.test/a.jpg", "https://user:password@ir.ozone.ru/a.jpg", "https://127.0.0.1/a.jpg", "https://ir.ozone.ru:444/a.jpg"]) expect(safeImageUrl(value, "ozon")).toBe(false);
    expect(() => imageExtension(Buffer.from("<svg></svg>"))).toThrow();
    expect(imageExtension(Buffer.from([0xff, 0xd8, 0xff]))).toBe("jpg");
  });
  it("copies photos once by content hash, serves them after startup and retains snapshot references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dprinta-marketplace-images-"));
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDk8AAAAASUVORK5CYII=", "base64");
    const transport: typeof fetch = async (_url, options) => {
      expect(options?.redirect).toBe("error"); expect(options?.headers).toBeUndefined();
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    };
    try {
      const paths = await importImages(["https://ir.ozone.ru/1.png", "https://ir.ozone.ru/2.png"], "ozon", transport, directory);
      expect(paths).toHaveLength(1);
      const filename = servedProductImageName(paths[0]); expect(filename).toMatch(/^mp-[0-9a-f]{64}\.png$/);
      expect(await readFile(join(directory, filename!))).toEqual(bytes);
      expect(storedProductImageName(paths[0])).toBeNull();
      expect(servedProductImageName("/uploads/products/mp-../../secret.png")).toBeNull();
      expect(await importImages(["https://ir.ozone.ru/1.png"], "ozon", transport, directory)).toEqual(paths);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("does not send merchant keys to arbitrary API URLs or expose provider errors", async () => {
    const transport = vi.fn(async () => json({ error: connection.secret }, 401));
    await expect(apiJson("https://attacker.test/", connection, "GET", undefined, transport)).rejects.toThrow("format");
    expect(transport).not.toHaveBeenCalled();
    await expect(apiJson("https://api-seller.ozon.ru/v3/product/list", connection, "POST", {}, transport)).rejects.toThrow(/^auth$/);
    expect(transport.mock.calls[0]).toBeDefined();
  });
  it("loads WB cards without photos, includes barcodes, uses seller rather than club prices", async () => {
    const transport = vi.fn(async () => json({ cards: [{ nmID: 11, vendorCode: "ITEM-1", title: "WB title", description: "<p>Text</p>", sizes: [{ skus: ["000123"] }], photos: [] }], cursor: { total: 1, updatedAt: "2026-10-03", nmID: 11 } }));
    const prices = new Map([["11", { nmID: "11", currencyIsoCode4217: "RUB", sizes: [{ price: 200, discountedPrice: 150, clubDiscountedPrice: 100 }] }]]);
    const page = await fetchPage("wb", connection, {}, transport, prices);
    expect(page.done).toBe(true);
    expect(page.items[0]).toMatchObject({ price: 150, oldPrice: 200, barcodes: ["000123"], description: "Text", issue: null });
    expect(JSON.parse(String((transport.mock.calls[0] as unknown[])[1] && ((transport.mock.calls[0] as unknown[])[1] as RequestInit).body)).settings.filter.withPhoto).toBe(-1);
  });
  it("flags differing variant prices instead of silently pricing all variants the same", async () => {
    const transport = vi.fn(async () => json({ cards: [{ nmID: 11, vendorCode: "ITEM-1", title: "WB title" }], cursor: { total: 1 } }));
    const page = await fetchPage("wb", connection, {}, transport, new Map([["11", { nmID: "11", currencyIsoCode4217: "RUB", sizes: [{ price: 200, discountedPrice: 150 }, { price: 300, discountedPrice: 220 }] }]]));
    expect(page.items[0].issue).toBe("prices");
  });
  it("preserves distinct WB nmIDs and shared imtID with colour labels", async () => {
    const cards = [11, 12].map((nmID, index) => ({ nmID, imtID: 900, vendorCode: `COLOUR-${nmID}`, title: "Same bowl title", characteristics: [{ name: "Цвет", value: [index ? "белый" : "зеленый"] }] }));
    const prices = new Map(cards.map(card => [String(card.nmID), { nmID: String(card.nmID), currencyIsoCode4217: "RUB", sizes: [{ price: 200, discountedPrice: 150 }] }]));
    const page = await fetchPage("wb", connection, {}, async () => json({ cards, cursor: { total: 2 } }), prices);
    expect(page.items.map(item => item.externalId)).toEqual(["11", "12"]);
    expect(page.items.map(item => item.group)).toEqual([{ id: "900", label: "зеленый" }, { id: "900", label: "белый" }]);
  });
  it("fails closed when a marketplace returns an unexpected response", async () => {
    await expect(fetchPage("ozon", connection, {}, async () => json({ items: [] }))).rejects.toThrow("format");
  });
  it("reads the full WB price list using GET and stops on an empty page", async () => {
    const calls: string[] = [];
    const transport: typeof fetch = async (url, options) => {
      calls.push(String(url)); expect(options?.method).toBe("GET");
      return json({ data: { listGoods: calls.length === 1 ? [{ nmID: 11, currencyIsoCode4217: "RUB", sizes: [{ price: 200, discountedPrice: 150 }] }] : [] }, error: false });
    };
    const prices = await fetchWbPrices(connection, transport);
    expect(prices.get("11")?.sizes[0].discountedPrice).toBe(150);
    expect(calls[1]).toContain("offset=1000");
  });
  it("loads Ozon listing, detailed fields and v5 seller prices together", async () => {
    const transport: typeof fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v3/product/list") return json({ result: { items: [{ product_id: 11, offer_id: "ITEM-1" }], last_id: "cursor", total: 1 } });
      if (path === "/v3/product/info/list") return json({ items: [{ id: 11, offer_id: "ITEM-1", name: "Ozon title", barcodes: ["000123"], images: ["https://ir.ozone.ru/b.jpg"], primary_image: ["https://ir.ozone.ru/a.jpg"] }] });
      if (path === "/v5/product/info/prices") return json({ items: [{ product_id: 11, price: { price: "150.50", old_price: "200", currency_code: "RUB" } }] });
      return json({ result: [{ id: 11, depth: 190, width: 55, height: 70, dimension_unit: "mm", weight: 85, weight_unit: "g", attributes: [{ id: 4191, values: [{ value: "Description" }] }, { id: 100, name: "Материал", values: [{ value: "PLA" }] }] }] });
    };
    const page = await fetchPage("ozon", connection, {}, transport);
    expect(page.items[0]).toMatchObject({ price: 150.5, description: "Description", specifications: { "Материал": "PLA" }, issue: null });
    expect(page.items[0].images).toEqual(["https://ir.ozone.ru/a.jpg", "https://ir.ozone.ru/b.jpg"]);
    expect(page.items[0].measurements?.packaging).toEqual({ shippingWeightG: 85, shippingLengthMm: 190, shippingWidthMm: 55, shippingHeightMm: 70 });
  });
});
