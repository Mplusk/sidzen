// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { METRIKA_CHOICE_KEY, METRIKA_ID, METRIKA_SETTINGS_EVENT } from "@/lib/metrika-policy";

vi.mock("next/navigation", () => ({ usePathname: () => window.location.pathname, useSearchParams: () => "" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children) }));

describe("Metrica consent interface", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.resetModules();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    history.replaceState(null, "", "/catalog/");
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.head.querySelectorAll('script[src*="mc.yandex.ru"]').forEach(script => script.remove());
    localStorage.clear();
  });
  it("requires a choice covering Top.Mail.Ru and removes the frame on private pages, disable and withdrawal", async () => {
    const { MetrikaConsent } = await import("./metrika-consent");
    localStorage.setItem(METRIKA_CHOICE_KEY, JSON.stringify({ choice: "accepted", at: Date.now() }));
    const render = (topMailEnabled = true) => act(async () => root.render(React.createElement(MetrikaConsent, { topMailEnabled })));
    const frame = () => container.querySelector('iframe[title="Top.Mail.Ru"]');
    await render();
    expect(frame()).toBeNull();
    await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Разрешить статистику")!.click());
    expect(frame()?.getAttribute("src")).toContain("page=%2Fcatalog%2F");
    history.pushState(null, "", "/checkout/");
    await render();
    expect(frame()).toBeNull();
    history.pushState(null, "", "/about/");
    await render(false);
    expect(frame()).toBeNull();
    await render();
    expect(frame()).not.toBeNull();
    act(() => window.dispatchEvent(new Event(METRIKA_SETTINGS_EVENT)));
    await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Только необходимые")!.click());
    expect(frame()).toBeNull();
    expect(JSON.parse(localStorage.getItem(METRIKA_CHOICE_KEY)!)).toMatchObject({ choice: "rejected", topMail: false });
  });
  it("does not load before consent, initializes after consent and stops on navigation and withdrawal", async () => {
    const { MetrikaConsent } = await import("./metrika-consent");
    await act(async () => root.render(React.createElement(MetrikaConsent)));
    expect(document.querySelector('script[src*="mc.yandex.ru"]')).toBeNull();
    const button = [...container.querySelectorAll("button")].find(el => el.textContent === "Разрешить статистику")!;
    await act(async () => button.click());
    const script = document.querySelector<HTMLScriptElement>('script[src*="mc.yandex.ru"]');
    expect(script).not.toBeNull();
    const ym = vi.fn();
    (window as unknown as {ym: unknown}).ym = ym;
    // A withdrawn consent must not initialize a still-downloading script.
    act(() => window.dispatchEvent(new Event(METRIKA_SETTINGS_EVENT)));
    await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Только необходимые")!.click());
    await act(async () => script!.dispatchEvent(new Event("load")));
    expect(ym).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event(METRIKA_SETTINGS_EVENT)));
    await act(async () => [...container.querySelectorAll("button")].find(el => el.textContent === "Разрешить статистику")!.click());
    expect(ym).toHaveBeenCalledWith(METRIKA_ID, "init", expect.objectContaining({ webvisor: true, defer: true, url: expect.stringContaining("/catalog/") }));
    expect(ym).toHaveBeenCalledWith(METRIKA_ID, "hit", expect.stringContaining("/catalog/"), { referer: "" });
    const privateLink = document.createElement("a"); privateLink.href = "/checkout/";
    document.body.appendChild(privateLink);
    privateLink.addEventListener("click", event => event.preventDefault());
    act(() => privateLink.click());
    expect(ym).toHaveBeenCalledWith(METRIKA_ID, "destruct");
    expect((window as unknown as {disableYaCounter114060671: boolean}).disableYaCounter114060671).toBe(true);
    privateLink.remove();
    history.pushState(null, "", "/about/");
    await act(async () => root.render(React.createElement(MetrikaConsent)));
    expect(ym).toHaveBeenCalledWith(METRIKA_ID, "hit", expect.stringContaining("/about/"), { referer: "" });
    ym.mockClear();
    act(() => window.dispatchEvent(new Event(METRIKA_SETTINGS_EVENT)));
    const reject = [...container.querySelectorAll("button")].find(el => el.textContent === "Только необходимые")!;
    await act(async () => reject.click());
    expect(ym).toHaveBeenCalledWith(METRIKA_ID, "destruct");
    expect(JSON.parse(localStorage.getItem(METRIKA_CHOICE_KEY)!).choice).toBe("rejected");
    expect((window as unknown as {disableYaCounter114060671: boolean}).disableYaCounter114060671).toBe(true);
  });
});
