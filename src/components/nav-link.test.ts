// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const route = vi.hoisted(() => ({ pathname: "/account/orders/123/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
import { NavLink } from "./nav-link";
import { CollapsibleNavigation } from "./collapsible-navigation";
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("marks the actual subsection without incorrectly marking its overview", async () => {
  route.pathname = "/account/orders/123/";
  await act(async () => root.render(createElement("nav", null, createElement(NavLink, { href: "/account/" }, "Обзор"), createElement(NavLink, { href: "/account/orders/" }, "Заказы"))));
  expect([...container.querySelectorAll("a")].map(a => a.getAttribute("aria-current"))).toEqual([null, "page"]);
});
it("supports top-level wayfinding and avoids matching similarly named sections", async () => {
  route.pathname = "/account/profile/";
  await act(async () => root.render(createElement(NavLink, { href: "/account/", exact: false }, "Кабинет")));
  expect(container.querySelector("a")!.getAttribute("aria-current")).toBe("page");
  route.pathname = "/account/orders-archive/";
  await act(async () => root.render(createElement(NavLink, { href: "/account/orders/" }, "Заказы")));
  expect(container.querySelector("a")!.getAttribute("aria-current")).toBeNull();
});
it("offers an explicit mobile disclosure, keeps its target labelled, and closes after choosing a section", async () => {
  await act(async () => root.render(createElement(CollapsibleNavigation, { label: "Разделы кабинета" }, createElement("a", { href: "#profile" }, "Профиль"))));
  const button = container.querySelector("button")!, nav = container.querySelector("nav")!;
  expect(button.getAttribute("aria-controls")).toBe(nav.id); expect(button.getAttribute("aria-expanded")).toBe("false");
  await act(async () => button.click()); expect(nav.getAttribute("data-expanded")).toBe("true");
  await act(async () => container.querySelector("a")!.click()); expect(button.getAttribute("aria-expanded")).toBe("false");
});
