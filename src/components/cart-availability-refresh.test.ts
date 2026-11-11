// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { CartAvailabilityRefresh } from "./cart-availability-refresh";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z")); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); refresh.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("refreshes after an hour and checks a previously hidden tab when it becomes visible", async () => {
  let visible = true;
  const visibility = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  const element = document.createElement("div");
  const root = createRoot(element);
  await act(async () => root.render(createElement(CartAvailabilityRefresh)));
  await act(async () => vi.advanceTimersByTime(3_599_999));
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(refresh).toHaveBeenCalledTimes(1);
  visible = false;
  await act(async () => vi.advanceTimersByTime(3_600_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  visible = true;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  visibility.mockRestore();
});
