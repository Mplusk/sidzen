// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePickupViewport } from "./use-pickup-viewport";
import type { PickupViewport, PickupViewportResult } from "@/lib/delivery/point-viewport";

const west: PickupViewport = { bounds: { west: 37.3, south: 55.7, east: 37.4, north: 55.8 }, zoom: 13 };
const east: PickupViewport = { bounds: { west: 37.7, south: 55.7, east: 37.8, north: 55.8 }, zoom: 13 };
const point = (id: string, longitude: number) => ({ id, longitude, latitude: 55.75, address: `Москва, адрес ${id}`, name: "Пункт Ozon", type: "pvz" });
const data = (id = "west", longitude = 37.35, scope = "directory"): PickupViewportResult => ({ points: [point(id, longitude)], clusters: [], scope });
let state: ReturnType<typeof usePickupViewport>, root: Root, container: HTMLDivElement;
function Harness() { const value = usePickupViewport(true); useLayoutEffect(() => { state = value; }); return null; }
const move = async (view: PickupViewport) => act(async () => state.onViewportChange(view));
const settle = async () => act(async () => { await vi.advanceTimersByTimeAsync(220); });

beforeEach(async () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json(data()))));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("waits for the visible viewport, debounces movement and requests only its bounded area", async () => {
  expect(fetch).not.toHaveBeenCalled();
  await move(west); await move(east); await move(west);
  expect(fetch).not.toHaveBeenCalled();
  await settle();
  expect(fetch).toHaveBeenCalledOnce();
  const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), "https://sidzen.shop");
  expect(url.searchParams.get("view")).toBe("viewport");
  expect(url.searchParams.has("q")).toBe(false);
  expect(url.searchParams.has("offset")).toBe(false);
  expect(url.searchParams.get("zoom")).toBe("13");
  const [w, s, e, n] = url.searchParams.get("bbox")!.split(",").map(Number);
  expect(w).toBeLessThan(west.bounds.west); expect(e).toBeGreaterThan(west.bounds.east);
  expect(e - w).toBeLessThan(.15); expect(n - s).toBeLessThan(.15);
  expect(state.points.map(p => p.id)).toEqual(["west"]);
});

it("opens another district without leaking old list results and ignores a late aborted response", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json(data("east", 37.75)));
  await move(west); await settle();
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  await move(east); expect(signal.aborted).toBe(true); await settle();
  expect(state.points.map(p => p.id)).toEqual(["east"]);
  await act(async () => finish(Response.json(data())));
  expect(state.points.map(p => p.id)).toEqual(["east"]);
  expect(state.error).toBe("");
});

it("reuses a recently visited area and does not refetch duplicate map events", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(data()))
    .mockResolvedValueOnce(Response.json(data("east", 37.75)));
  await move(west); await settle(); await move(west); await settle();
  expect(fetch).toHaveBeenCalledOnce();
  await move(east); expect(state.points).toEqual([]); await settle();
  await move(west); await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state.points.map(p => p.id)).toEqual(["west"]);
  expect(state.pending).toBe(false);
});

it("requests detail again after zooming, even when the bounds were cached", async () => {
  await move(west); await settle(); await move({ ...west, zoom: 15 }); await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("zoom=15");
});

it("discards cache from a previous directory generation", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(data()))
    .mockResolvedValueOnce(Response.json(data("east", 37.75, "updated")))
    .mockResolvedValueOnce(Response.json(data("new-west", 37.35, "updated")));
  await move(west); await settle(); await move(east); await settle(); await move(west); await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(state.points.map(p => p.id)).toEqual(["new-west"]);
});

it("shows recoverable errors and retries the current area without closing the map", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
  await move(west); await settle();
  expect(state.error).toContain("Повторите загрузку"); expect(state.pending).toBe(false);
  await act(async () => state.retry()); await settle();
  expect(state.error).toBe(""); expect(state.points).toHaveLength(1);
});

it("bounds cached areas and only keeps results inside the current map", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...data(), points: [point("west", 37.35), point("outside", 38)], clusters: [{ id: "cluster", latitude: 55.75, longitude: 37.39, count: 20, bounds: west.bounds }] }));
  await move(west); await settle();
  expect(state.points.map(p => p.id)).toEqual(["west"]); expect(state.clusters).toHaveLength(1);
  await move(east); expect(state.points).toHaveLength(0); expect(state.clusters).toHaveLength(0);
});

it("keeps border clusters visible while preserving their drill-down bounds", async () => {
  const bounds = { ...west.bounds, west: 37.399, east: 37.411 };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: [], clusters: [{ id: "edge", latitude: 55.75, longitude: 37.405, count: 20, bounds }], scope: "directory" }));
  await move(west); await settle();
  expect(state.clusters[0].longitude).toBeLessThan(west.bounds.east);
  expect(state.clusters[0].bounds).toEqual(bounds);
});

it("shows clustered address previews separately, bounds them to the camera and restores them from cache", async () => {
  const cluster = { id: "area", latitude: 55.75, longitude: 37.35, count: 2000, bounds: west.bounds };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ points: [], clusters: [cluster], listPoints: [point("nearest", 37.35), point("nearest", 37.35), point("padded", 37.405)], scope: "directory" }))
    .mockResolvedValueOnce(Response.json({ ...data("east", 37.75), listPoints: [point("east-preview", 37.75)] }));
  await move(west); await settle();
  expect(state.points).toEqual([]); expect(state.clusters).toHaveLength(1);
  expect(state.listPoints.map(p => p.id)).toEqual(["nearest"]);
  await move(east); expect(state.listPoints).toEqual([]); await settle();
  expect(state.listPoints.map(p => p.id)).toEqual(["east-preview"]);
  await move(west);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state.listPoints.map(p => p.id)).toEqual(["nearest"]);
  expect(state.points).toEqual([]);
});

it("rejects malformed or unbounded sidebar previews as a recoverable viewport error", async () => {
  const invalid = [{ address: "bad" }, [null], [{ ...point("invalid", 37.35), latitude: null }], Array.from({ length: 21 }, (_, index) => point(String(index), 37.35))];
  for (const [index, listPoints] of invalid.entries()) {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...data(), listPoints }));
    if (index === 0) await move(west);
    else await act(async () => state.retry());
    await settle();
    expect(state.error).not.toBe(""); expect(state.listPoints).toEqual([]);
  }
});

it("loads dense max-zoom points only on demand and caches the expanded list", async () => {
  const detail = { ...west, zoom: 18 };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...data(), nextOffset: 500 }))
    .mockResolvedValueOnce(Response.json({ ...data("second", 37.36), nextOffset: null }))
    .mockResolvedValueOnce(Response.json(data("east", 37.75)));
  await move(detail); await settle();
  expect(fetch).toHaveBeenCalledOnce(); expect(state.nextOffset).toBe(500);
  await act(async () => { await state.loadMore(); });
  expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("&offset=500");
  expect(state.points.map(point => point.id)).toEqual(["west", "second"]); expect(state.nextOffset).toBeNull();
  expect(state.listPoints.map(point => point.id)).toEqual(["west", "second"]);
  await move({ ...east, zoom: 18 }); await settle(); await move(detail); await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(state.points.map(point => point.id)).toEqual(["west", "second"]);
});

it("does not combine dense pages from a different directory or a district left behind", async () => {
  const detail = { ...west, zoom: 18 };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...data(), nextOffset: 500 }))
    .mockResolvedValueOnce(Response.json({ ...data("wrong", 37.36, "changed"), nextOffset: null }));
  await move(detail); await settle(); await act(async () => { await state.loadMore(); });
  expect(state.points.map(point => point.id)).toEqual(["west"]); expect(state.error).not.toBe("");
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(Response.json(data("east", 37.75)));
  await act(async () => { void state.loadMore(); });
  await move(east); await settle();
  await act(async () => finish(Response.json({ ...data("late", 37.36), nextOffset: null })));
  expect(state.points.map(point => point.id)).toEqual(["east"]);
});

it("cancels in-flight and scheduled loading when the dialog closes", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  await move(west); await settle();
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(fetch).toHaveBeenCalledOnce();
});
