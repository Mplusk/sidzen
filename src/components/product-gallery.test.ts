// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/image", () => ({ default: ({ fill: _fill, preload: _preload, ...props }: Record<string, unknown>) => { void _fill; void _preload; return createElement("img", props); } }));
import { ProductGallery } from "./product-gallery";

let root: Root, container: HTMLDivElement;
const images = [{ path: "/one.jpg", alt: "Первое", width: 800, height: 1000 }, { path: "/two.jpg", alt: "Второе", width: 1000, height: 500 }, { path: "/three.jpg", alt: "Третье" }];
let reduced = false;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  reduced = false;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(compact = false, highPriority = false) {
  await act(async () => root.render(createElement(ProductGallery, { images, name: "Чаша", compact, highPriority, href: compact ? "/catalog/bowl/" : undefined })));
  const viewport = container.querySelector<HTMLDivElement>(".product-gallery__viewport")!;
  Object.defineProperty(viewport, "clientWidth", { value: 400 });
  viewport.scrollTo = vi.fn((options) => { viewport.scrollLeft = (options as ScrollToOptions).left ?? 0; });
  return viewport;
}
it("renders native scrollable slides and keeps the frame stable for different photo ratios", async () => {
  const viewport = await render();
  expect(viewport.children).toHaveLength(3);
  const frame = container.querySelector<HTMLElement>(".product-gallery__main")!;
  expect(frame.style.aspectRatio).toBe("0.8");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Следующее фото"]')!.click());
  expect(viewport.scrollTo).toHaveBeenCalledWith({ left: 400, behavior: "smooth" });
  expect(frame.style.aspectRatio).toBe("0.8");
  expect(container.querySelector(".gallery-counter")!.textContent).toBe("2 / 3");
});
it("synchronizes swipe/trackpad position, selected dot and accessible link without a custom end-only gesture", async () => {
  const viewport = await render(true);
  await act(async () => { viewport.scrollLeft = 800; viewport.dispatchEvent(new Event("scroll")); });
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Фото 3"]')!.getAttribute("aria-pressed")).toBe("true");
  const slides = [...container.querySelectorAll(".product-gallery__slide")];
  expect(slides.map(slide => slide.getAttribute("aria-hidden"))).toEqual(["true", "true", "false"]);
  expect([...container.querySelectorAll<HTMLAnchorElement>(".product-gallery__photo")].map(link => link.tabIndex)).toEqual([-1, -1, 0]);
});
it("supports keyboard and immediate reduced-motion navigation including wraparound", async () => {
  const viewport = await render(); reduced = true;
  const frame = container.querySelector<HTMLElement>(".product-gallery__main")!;
  await act(async () => frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })));
  expect(viewport.scrollTo).toHaveBeenLastCalledWith({ left: 400, behavior: "instant" });
  reduced = false;
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Фото 1"]')!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Предыдущее фото"]')!.click());
  expect(viewport.scrollTo).toHaveBeenLastCalledWith({ left: 800, behavior: "instant" });
});
it("does not render unusable navigation for a missing or single photo", async () => {
  for (const value of [[], [images[0]]]) {
    await act(async () => root.render(createElement(ProductGallery, { images: value, name: "Чаша" })));
    expect(container.querySelector(".gallery-arrow")).toBeNull();
    expect(container.querySelector(".gallery-thumbnails")).toBeNull();
  }
});
it("requests only the first large photo initially while retaining every swipe slot", async () => {
  const viewport = await render(true);
  expect(viewport.children).toHaveLength(3);
  expect(viewport.querySelectorAll("img")).toHaveLength(1);
  expect(viewport.querySelector("img")!.getAttribute("src")).toBe("/one.jpg");
  expect(viewport.querySelectorAll(".gallery-image-placeholder")).toHaveLength(2);
  await act(async () => { viewport.scrollLeft = 800; viewport.dispatchEvent(new Event("scroll")); });
  expect(viewport.querySelector('img[src="/three.jpg"]')).not.toBeNull();
});
it("prepares adjacent photos on touch before the native swipe begins", async () => {
  const viewport = await render(true);
  expect(viewport.querySelectorAll("img")).toHaveLength(1);
  await act(async () => viewport.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(viewport.querySelectorAll("img")).toHaveLength(3);
  expect(viewport.scrollTo).not.toHaveBeenCalled();
});
it("assigns eager high priority only to the first photo of priority cards", async () => {
  const viewport = await render(true, true);
  const first = viewport.querySelector("img")!;
  expect(first.getAttribute("loading")).toBe("eager");
  expect(first.getAttribute("fetchpriority")).toBe("high");
  await act(async () => viewport.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  for (const img of [...viewport.querySelectorAll("img")].slice(1)) {
    expect(img.getAttribute("loading")).toBe("lazy"); expect(img.getAttribute("fetchpriority")).toBeNull();
  }
});
it("reveals a newly visible slide through IntersectionObserver and disconnects it", async () => {
  let callback: IntersectionObserverCallback | undefined;
  const disconnect = vi.fn(), observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(value: IntersectionObserverCallback) { callback = value; }
    observe = observe;
    disconnect = disconnect;
  });
  const viewport = await render(true);
  expect(observe).toHaveBeenCalledTimes(3);
  await act(async () => callback!([{ isIntersecting: true, target: viewport.children[1] } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(viewport.querySelector('img[src="/two.jpg"]')).not.toBeNull();
  expect(viewport.querySelector('img[src="/three.jpg"]')).toBeNull();
  await act(async () => root.render(null)); expect(disconnect).toHaveBeenCalledTimes(1);
});
