import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deployment = readFileSync("scripts/deploy-release.sh", "utf8");
const composeFunction = deployment.match(/compose_for\(\) \{[\s\S]*?\n\}/)?.[0];

describe("SSH-streamed release deployment", () => {
  it("does not let Compose consume the remaining deployment commands", () => {
    expect(composeFunction).toBeDefined();
    const script = [
      // macOS ships Bash 3, where nounset rejects empty arrays. This test
      // isolates streamed stdin; the production host uses Bash 5.
      "set -Eeo pipefail",
      "compose_project=shop_test",
      "project_root=/nonexistent/shop-test-root",
      "shared_env=/nonexistent/test.env",
      "docker() { local consumed; if IFS= read -r consumed; then printf 'consumed:%s\\n' \"$consumed\"; fi; }",
      composeFunction,
      "compose_for /nonexistent/shop-test run --rm proxy caddy validate",
      "printf 'activation-reached\\n'",
    ].join("\n");
    const output = execFileSync("bash", ["-s"], { input: script, encoding: "utf8" });
    expect(output).toBe("activation-reached\n");
  });

  it("loads immutable prebuilt images and retains host-specific proxy overrides", () => {
    expect(deployment).toContain('${project_root}/shared/compose.override.yaml');
    expect(deployment).toContain('SHOP_IMAGE_TAG="$(basename "$release_dir")"');
    expect(deployment).toContain('gzip -dc "$image_artifact" | docker image load');
    expect(deployment).toContain('"3dprinta-${service_image}:${release_sha}"');
    expect(deployment).toContain('up -d --no-build --remove-orphans');
  });

  it("keeps backups from consuming following commands in a streamed SSH session", () => {
    const backup = readFileSync("scripts/backup.sh", "utf8");
    expect(backup).toContain('--format=custom < /dev/null > "${destination}/database.dump"');
  });
});
