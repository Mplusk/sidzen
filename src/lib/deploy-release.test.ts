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

  it("cleans orphaned shop migrators without removing rollback or other used images", () => {
    const cleanup = deployment.match(/cleanup_unused_shop_images\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(cleanup).toBeDefined();
    const script = [
      "set -Eeo pipefail",
      "docker() {",
      "  if [[ \"$1 $2\" == 'image ls' ]]; then printf '%s\\n' sha256:current sha256:rollback sha256:used_elsewhere sha256:orphan_migrator;",
      "  elif [[ \"$1\" == ps ]]; then [[ \"$*\" != *ancestor=sha256:used_elsewhere* ]] || printf 'unrelated-container\\n';",
      "  elif [[ \"$1 $2\" == 'image rm' ]]; then printf 'removed:%s\\n' \"$3\"; fi",
      "}",
      cleanup,
      "cleanup_unused_shop_images $'sha256:current\\nsha256:rollback'",
    ].join("\n");
    expect(execFileSync("bash", ["-s"], { input: script, encoding: "utf8" })).toBe("removed:sha256:orphan_migrator\n");
    expect(cleanup).toContain("--filter label=com.3dprinta.project=shop");
  });

  it("checks disk reserve before importing images or stopping the working shop", () => {
    expect(deployment.indexOf('require_disk_space "$(( ')).toBeLessThan(deployment.indexOf('gzip -dc "$image_artifact" | docker image load'));
    expect(deployment).toContain('image_storage_bytes="$(python3 "${final_release}/scripts/estimate-image-space.py" "$image_artifact")"');
    expect(deployment).toContain('require_disk_space 524288');
    expect(deployment).toContain('release_image_ids "$previous_release"; release_image_ids "$final_release"');
  });

  it("counts nested compressed layers and legacy raw layers without extracting paths", () => {
    const script = [
      "import gzip, io, runpy, tarfile",
      "estimate = runpy.run_path('scripts/estimate-image-space.py')['estimate_bytes']",
      "raw = b'x' * (3 * 1024 * 1024)",
      "compressed = gzip.compress(raw)",
      "output = io.BytesIO()",
      "with tarfile.open(fileobj=output, mode='w:gz') as archive:",
      "    for name, content in [('blobs/sha256/test', compressed), ('legacy/layer.tar', b'raw layer'), ('../never-extracted.json', b'{}')]:",
      "        entry = tarfile.TarInfo(name); entry.size = len(content)",
      "        archive.addfile(entry, io.BytesIO(content))",
      "output.seek(0)",
      "assert estimate(output) == len(compressed) + len(raw) + 2 * len(b'raw layer') + 4",
      "print('counted-without-extraction')",
    ].join("\n");
    expect(execFileSync("python3", ["-c", script], { encoding: "utf8" })).toBe("counted-without-extraction\n");
  });
});
