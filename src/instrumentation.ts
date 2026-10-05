import type { Instrumentation } from "next";

// Never serialize error/request/context: headers, URL query and exception text
// can contain secrets and buyer data. Edge does not have the database runtime.
export const onRequestError: Instrumentation.onRequestError = async () => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { writeDiagnostic } = await import("@/lib/diagnostics");
  await writeDiagnostic("server.failed");
};
