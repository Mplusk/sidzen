import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

// Use the real Next response, but post the synthetic token only to this fixture.
const upstream = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
assert(["localhost", "127.0.0.1"].includes(upstream.hostname));
const response = await fetch(new URL("/admin-login-confirm/", upstream));
assert.equal(response.status, 200);
assert.equal(response.headers.get("referrer-policy"), "same-origin");
const html = await response.text();
const clickScript = "document.getElementById('submit').click()";
const clickHash = createHash("sha256").update(clickScript).digest("base64");
const csp = response.headers.get("content-security-policy");
assert(csp?.includes("script-src 'sha256-"));
const fixtureCsp = csp.replace("script-src ", `script-src 'sha256-${clickHash}' `);
const fixtureHtml = html.replace("</body>", `<script>${clickScript}</script></body>`);
const token = "A".repeat(43);
let finish;
let submitted = false;
const requests = [];
const posted = new Promise(resolvePromise => { finish = resolvePromise; });
const server = createServer((request, result) => {
  requests.push(`${request.method} ${new URL(request.url, "http://localhost").pathname}`);
  if (request.method === "POST" && request.url === "/admin-login-confirm/") {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      submitted = true;
      finish({ origin: request.headers.origin, body: Buffer.concat(chunks).toString(), referer: request.headers.referer });
      result.writeHead(200, { "content-type": "text/plain" }).end("ok");
    });
    return;
  }
  result.writeHead(200, { "content-type": "text/html; charset=utf-8", "referrer-policy": "same-origin", "content-security-policy": fixtureCsp }).end(fixtureHtml);
});
await new Promise(resolvePromise => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const profile = await mkdtemp(join(tmpdir(), "sidzen-confirm-browser-"));
const chrome = process.env.CHROME_BIN || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", `--user-data-dir=${profile}`, "--dump-dom", `${origin}/admin-login-confirm/?enroll=1#${token}`], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "", stdout = "";
child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-8000); });
const stopped = new Promise((_, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => { if (!submitted) reject(new Error(`Chromium exited before form submission (code=${code}, signal=${signal})`)); });
});
let timer;
try {
  const result = await Promise.race([posted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Browser form POST timed out")), 60000); }), stopped]);
  assert.equal(result.origin, origin, "Browser must send a valid Origin");
  const body = new URLSearchParams(result.body);
  assert.equal(body.get("token"), token);
  assert.equal(body.get("intent"), "enroll");
  assert(!result.referer?.includes(token), "The URL fragment must not be sent as Referer");
  console.log("PASS: real Chromium submits the isolated Next confirmation document with a valid Origin.");
} catch (error) {
  // This fixture has no real credentials; still redact its synthetic token so
  // diagnostics cannot be confused with a usable administrator sign-in link.
  const redact = value => value.replaceAll(token, "[synthetic-token]").replaceAll(profile, "[temporary-profile]");
  console.error("Chromium fixture requests:", requests.join(", ") || "none");
  console.error("Chromium stderr:", redact(stderr) || "empty");
  console.error("Chromium DOM:", redact(stdout) || "empty");
  throw error;
} finally {
  clearTimeout(timer);
  child.kill();
  server.close();
  server.closeAllConnections();
  if (resolve(profile).startsWith(resolve(tmpdir()) + sep)) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
