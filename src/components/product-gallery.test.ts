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
async function render(compact = false) {
  await act(async () => root.render(createElement(ProductGallery, { images, name: "Чаша", compact, href: compact ? "/catalog/bowl/" : undefined })));
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
