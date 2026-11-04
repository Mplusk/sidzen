import { describe, expect, it } from "vitest";
import { METRIKA_CHOICE_KEY, metrikaPublicUrl, readMetrikaChoice } from "./metrika-policy";

const now = 1_800_000_000_000;
const storage = (value: string | null) => ({ getItem: (key: string) => key === METRIKA_CHOICE_KEY ? value : null });
describe("Metrica consent and route policy", () => {
  it("accepts only a valid, recent, explicit choice", () => {
    for (const value of [null, "bad JSON", '{}', JSON.stringify({choice:"accepted",at:now+1}), JSON.stringify({choice:"accepted",at:now-180*86400000}), JSON.stringify({choice:"other",at:now})]) expect(readMetrikaChoice(storage(value), now)).toBeNull();
    expect(readMetrikaChoice(storage(JSON.stringify({choice:"accepted",at:now})), now)).toBe("accepted");
    expect(readMetrikaChoice(storage(JSON.stringify({choice:"rejected",at:now})), now)).toBe("rejected");
    expect(readMetrikaChoice({getItem: () => { throw Error("denied"); }}, now)).toBeNull();
  });
  it("allows only public pages and the fixed Yandex debug flag", () => {
    expect(metrikaPublicUrl("https://sidzen.shop/")).toBe("https://sidzen.shop/");
    expect(metrikaPublicUrl("https://sidzen.shop/?_ym_debug=2")).toBe("https://sidzen.shop/");
    expect(metrikaPublicUrl("https://sidzen.shop/catalog/item")).toBe("https://sidzen.shop/catalog/item/");
    for (const url of ["https://sidzen.shop/account/", "https://sidzen.shop/checkout/", "https://sidzen.shop/search/", "https://sidzen.shop/catalog/?q=Иван", "https://sidzen.shop/?_ym_debug=2&q=Иван", "https://sidzen.shop/?_ym_debug=Иван", "https://sidzen.shop/?_ym_debug=2&_ym_debug=2", "https://sidzen.shop/catalog/#x", "not a URL"]) expect(metrikaPublicUrl(url)).toBeNull();
  });
});
