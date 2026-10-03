"""Preserve independently managed virtual hosts/networks during shop releases."""
import json
import re
import subprocess
import sys
from pathlib import Path

previous = Path(sys.argv[1]) if sys.argv[1] else None
release = Path(sys.argv[2])
current = previous / "deploy/caddy/Caddyfile" if previous else None
target = release / "deploy/caddy/Caddyfile"
text = target.read_text()
if current and current.is_file():
    for match in re.finditer(r"(?m)^# BEGIN (?P<name>[^\n]+) managed\n.*?^# END (?P=name) managed(?:\n|$)", current.read_text(), re.S):
        marker = f"# BEGIN {match.group('name')} managed"
        if marker not in text:
            text += "\n" + match.group(0)
    target.write_text(text)

result = subprocess.run(
    ["docker", "inspect", "3dprinta-proxy-1", "--format", "{{json .NetworkSettings.Networks}}"],
    check=False, capture_output=True, text=True,
)
if result.returncode == 0:
    shared = sorted(name for name in json.loads(result.stdout) if name != "3dprinta_default")
    if shared:
        lines = ["services:", "  proxy:", "    networks:", "      default: {}"]
        lines += [f"      shared-proxy-{index}: {{}}" for index in range(len(shared))]
        lines += ["networks:"]
        for index, name in enumerate(shared):
            lines += [f"  shared-proxy-{index}:", "    external: true", f"    name: {json.dumps(name)}"]
        (release / ".compose-proxy-networks.yaml").write_text("\n".join(lines) + "\n")
print("Independently managed proxy routes and external networks preserved.")
