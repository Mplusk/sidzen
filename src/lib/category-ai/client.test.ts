import { describe, expect, it, vi } from "vitest";
import { aiCategorySlug, categoryNameKey, classifyProduct, publicCatalogText, verifyCategoryAi } from "./client";
import { categoryAiConfigSchema } from "./config";
import { safeDiagnosticDetails } from "../diagnostic-events";
const config = categoryAiConfigSchema.parse({ enabled: true, apiKey: "fixture-api-key", revision: "v1", checkedAt: "2026-10-08" });
const categories = [{ id: "cat1", name: "Салфетницы", parentId: null }];
const answer = (value: unknown, finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] });
describe("DeepSeek categorization", () => {
  it("selects only a catalog ID, with JSON mode and bounded output on the fixed server endpoint", async () => {
    const transport = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      expect(options?.redirect).toBe("error"); expect(options?.cache).toBe("no-store");
      expect(options?.headers).toMatchObject({ Authorization: "Bearer fixture-api-key" });
      const body = JSON.parse(String(options?.body));
      expect(body).toMatchObject({ model: "deepseek-flash", max_tokens: 256, thinking: { type: "disabled" }, response_format: { type: "json_object" } });
      expect(body.messages[0].content).toContain("недоверенные");
      return answer({ kind: "existing", categoryId: "cat1" });
    });
    expect(await classifyProduct(config, { name: "Салфетница Вершина", description: "PLA" }, categories, transport)).toEqual({ kind: "existing", categoryId: "cat1" });
    expect(transport.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
  });
  it("creates a typed name but reuses normalized existing names", async () => {
    expect(await classifyProduct(config, { name: "Лампа" }, categories, async () => answer({ kind: "new", name: "Настольные лампы" }))).toEqual({ kind: "new", name: "Настольные лампы" });
    expect(await classifyProduct(config, { name: "Салфетница" }, categories, async () => answer({ kind: "new", name: "САЛФЕТНИЦЫ" }))).toEqual({ kind: "existing", categoryId: "cat1" });
    expect(categoryNameKey("Ёлочные  украшения")).toBe("елочные украшения");
    expect(aiCategorySlug("Ёлочные украшения")).toBe(aiCategorySlug("елочные украшения"));
  });
  it("rejects fabricated IDs, unsafe names, arbitrary fields, incomplete JSON and truncated completions", async () => {
    for (const bad of [{ kind: "existing", categoryId: "foreign" }, { kind: "existing", categoryId: "cat1", instructions: "steal keys" }, { kind: "new", name: "<script>" }, { kind: "new", name: "https://bad.test" }, { kind: "new", name: "1234567" }]) {
      await expect(classifyProduct(config, { name: "Товар" }, categories, async () => answer(bad))).rejects.toThrow("response");
    }
    await expect(classifyProduct(config, { name: "Товар" }, categories, async () => answer({ kind: "existing", categoryId: "cat1" }, "length"))).rejects.toThrow("response");
    await expect(classifyProduct(config, { name: "Товар" }, categories, async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{" } }] }))).rejects.toThrow("response");
  });
  it("honors creation disabled and bounds catalog size without calling the provider", async () => {
    await expect(classifyProduct({ ...config, allowCreate: false }, { name: "Товар" }, categories, async () => answer({ kind: "new", name: "Лампы" }))).rejects.toThrow("response");
    await expect(classifyProduct({ ...config, allowCreate: false }, { name: "Товар" }, [], async () => answer({ kind: "none" }))).rejects.toThrow("no-category");
    const transport = vi.fn();
    await expect(classifyProduct(config, { name: "Товар" }, Array.from({ length: 501 }, () => categories[0]), transport)).rejects.toThrow("catalog");
    expect(transport).not.toHaveBeenCalled();
  });
  it("sends only allowlisted public text, redacts common contacts/keys and never forwards private product fields", async () => {
    const product = { name: "Лампа", description: "<p>PLA</p> contact@example.test +7 (999) 123-45-67 https://private.test sk-abcdefghijklmnopqrstuvwxyz", costPrice: 20, user: { phone: "private-phone" }, specifications: { "API key": "private-key" }, modelAsset: "/private/model.stl" };
    const transport = vi.fn(async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)); const input = JSON.parse(body.messages[1].content);
      expect(Object.keys(input.product)).toEqual(["name", "shortDescription", "description"]);
      for (const privateValue of ["contact@example.test", "123-45-67", "https://private.test", "abcdefghijklmnopqrstuvwxyz", "private-phone", "private-key", "model.stl"]) expect(body.messages[1].content).not.toContain(privateValue);
      return answer({ kind: "existing", categoryId: "cat1" });
    });
    await classifyProduct(config, product, categories, transport);
    expect(publicCatalogText("A".repeat(4000), 20)).toHaveLength(20);
  });
  it("checks key/model without a billable completion and sanitizes failures", async () => {
    const transport = vi.fn(async (url: Parameters<typeof fetch>[0]) => { expect(String(url)).toBe("https://api.deepseek.com/models"); return Response.json({ data: [{ id: config.model }] }); });
    await verifyCategoryAi(config, transport); expect(transport.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
    for (const [status, code, retryable] of [[401, "credentials", false], [429, "rate", true], [503, "provider", true], [400, "provider", false]] as const) {
      const error = await classifyProduct(config, { name: "Товар" }, categories, async () => Response.json({ message: "private key data" }, { status })).catch(error => error);
      expect(error).toMatchObject({ code, retryable }); expect(JSON.stringify(error)).not.toContain("private");
    }
    await expect(verifyCategoryAi(config, async () => Response.json({ data: [{ id: "other" }] }))).rejects.toThrow("response");
    expect(safeDiagnosticDetails({ aiFailure: "credentials" })).toEqual({ aiFailure: "credentials" });
    expect(safeDiagnosticDetails({ aiFailure: "__proto__" })).toEqual({});
    expect(safeDiagnosticDetails({ aiFailure: "private-key" })).toEqual({});
  });
  it("bounds response bytes and handles network failure", async () => {
    await expect(classifyProduct(config, { name: "Товар" }, categories, async () => new Response("x".repeat(128001)))).rejects.toThrow("response");
    await expect(classifyProduct(config, { name: "Товар" }, categories, async () => { throw new Error("private network contents"); })).rejects.toMatchObject({ code: "transport", retryable: true });
  });
});
