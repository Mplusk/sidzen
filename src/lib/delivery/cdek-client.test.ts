import { describe, expect, it, vi } from "vitest";
import { CdekDeliveryClient } from "./cdek-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("CDEK delivery client", () => {
  it("authenticates against the selected environment and requests city suggestions and paged pickup points", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ access_token: "test-token" })).mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([]));
    const client = new CdekDeliveryClient({ clientId: "test-account", clientSecret: "test-secret" }, "test", transport);
    await client.suggestCities("Яблоновский");
    await client.deliveryPointsPage(42, 1);
    expect(new URL(String(transport.mock.calls[0][0])).origin).toBe("https://api.edu.cdek.ru");
    expect(new URL(String(transport.mock.calls[1][0])).searchParams.get("name")).toBe("Яблоновский");
    expect(new URL(String(transport.mock.calls[2][0])).searchParams.get("page")).toBe("1");
    expect(transport.mock.calls[2][1]?.headers).toEqual({ Authorization: "Bearer test-token" });
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("does not expose provider errors or credentials when authentication fails", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "secret customer data" }, 401));
    const client = new CdekDeliveryClient({ clientId: "test-account", clientSecret: "test-secret" }, "production", transport);
    const error = await client.suggestCities("Москва").catch(value => value);
    expect(error).toMatchObject({ message: "credentials" });
    expect(JSON.stringify(error)).not.toMatch(/secret|customer/);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
