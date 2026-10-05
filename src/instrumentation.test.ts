import { afterEach, expect, it, vi } from "vitest";
const log = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: log }));
import { onRequestError } from "./instrumentation";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("records generic server failures without ever logging exception or request contents", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  await onRequestError(new Error("password email phone secret"), { path: "/checkout/?token=secret", method: "POST", headers: { authorization: "Bearer secret" } }, { routerKind: "App Router", routePath: "/checkout", routeType: "action", renderSource: "react-server-components", revalidateReason: undefined });
  expect(log).toHaveBeenCalledWith("server.failed"); expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  log.mockClear(); vi.stubEnv("NEXT_RUNTIME", "edge");
  await onRequestError(null, { path: "/", method: "GET", headers: {} }, { routerKind: "App Router", routePath: "/", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined });
  expect(log).not.toHaveBeenCalled();
});
