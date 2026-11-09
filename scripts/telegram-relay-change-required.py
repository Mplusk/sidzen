#!/usr/bin/env python3
"""Determine whether the verified release needs a Telegram relay deployment."""
import os
import re
import subprocess


RELAY_PATHS = (
    "deploy/telegram-relay",
    "scripts/deploy-telegram-relay.sh",
    "scripts/provision-docker-host.sh",
    "scripts/registry-release-manifest.py",
)


def relay_deployment_required(event: str, before: str, after: str) -> bool:
    # Manual dispatch and unknown/missing history deliberately deploy the relay.
    if event != "push" or not all(re.fullmatch(r"[0-9a-f]{40}", value or "") and int(value, 16) for value in (before, after)):
        return True
    try:
        result = subprocess.run(
            ["git", "diff", "--no-renames", "--name-only", "-z", before, after, "--", *RELAY_PATHS],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return True
    return bool(result.stdout)


if __name__ == "__main__":
    required = relay_deployment_required(os.environ.get("GITHUB_EVENT_NAME", ""), os.environ.get("PUSH_BEFORE", ""), os.environ.get("GITHUB_SHA", ""))
    print("true" if required else "false")
