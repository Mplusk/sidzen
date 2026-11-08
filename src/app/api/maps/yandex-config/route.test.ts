import { expect, it } from "vitest";
import { GET } from "./route";

it("does not expose the retired Yandex map configuration", async () => {
  const response = await GET();
  expect(response.status).toBe(410);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe("");
});
