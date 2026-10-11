import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("never reintroduces the retired storefront domain into project files", () => {
  const root = new URL("../../", import.meta.url);
  const retiredHost = ["3dprinta", "shop"].join(".");
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const remaining = paths.filter(path => /\.(?:ts|tsx|js|mjs|cjs|json|md|yaml|yml|conf|sh|py)$/.test(path) || ["Dockerfile", ".env.example", "deploy/caddy/Caddyfile"].includes(path))
    .filter(path => readFileSync(new URL(path, root), "utf8").toLowerCase().includes(retiredHost));
  expect(remaining).toEqual([]);
});
