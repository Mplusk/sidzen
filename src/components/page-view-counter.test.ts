// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/catalog/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { PageViewCounter } from "./page-view-counter";
let root: Root, container: HTMLDivElement;
const network = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", network); network.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" }); Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  localStorage.clear(); sessionStorage.clear(); route.pathname = "/catalog/";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(createElement(StrictMode, null, createElement(PageViewCounter)))); };
const counts = () => network.mock.calls.filter(call => call[0] === "/api/page-views/");
it("counts once under StrictMode without cookies, identifiers, referrer or storage writes", async () => {
  localStorage.setItem("sidzen_statistics_choice_v1", "old"); sessionStorage.setItem("sidzen_statistics_visit", "old-id"); localStorage.setItem("cart-draft", "keep");
  await render(); await act(async () => document.dispatchEvent(new Event("visibilitychange"))); await render();
  expect(counts()).toHaveLength(1);
  expect(counts()[0][1]).toEqual({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true, headers: { "Content-Type": "application/json" }, body: '{"path":"/catalog/"}' });
  expect(localStorage.getItem("sidzen_statistics_choice_v1")).toBeNull(); expect(sessionStorage.getItem("sidzen_statistics_visit")).toBeNull(); expect(localStorage.getItem("cart-draft")).toBe("keep");
  expect(container.innerHTML).toBe("");
  route.pathname = "/catalog/decor/coral/"; await render(); route.pathname = "/catalog/"; await render(); expect(counts()).toHaveLength(3);
});
it("never counts private pages or a browser privacy opt-out", async () => {
  route.pathname = "/account/orders/"; await render(); expect(counts()).toHaveLength(0);
  route.pathname = "/catalog/"; Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" }); await render(); expect(counts()).toHaveLength(0);
});
it("waits for a visible document, with no periodic heartbeat", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await render(); expect(counts()).toHaveLength(0);
  visibility.mockReturnValue("visible"); await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(counts()).toHaveLength(1);
  await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(counts()).toHaveLength(1);
});
