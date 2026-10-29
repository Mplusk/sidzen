"""Validate a CI release manifest before using any registry reference or path."""
import json
import re
import sys

COMPONENTS = ("app", "migrate", "marketplace-worker", "telegram-relay")


def validate(data, revision, prefix):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid revision")
    if not re.fullmatch(r"ghcr\.io/[a-z0-9-]+/sidzen", prefix):
        raise ValueError("Invalid registry prefix")
    if data.get("version") != 1 or data.get("revision") != revision:
        raise ValueError("Manifest revision mismatch")
    source = data.get("sourceSha256", "")
    if not isinstance(source, str) or not re.fullmatch(r"[0-9a-f]{64}", source):
        raise ValueError("Invalid source checksum")
    images = data.get("images")
    if not isinstance(images, dict) or set(images) != set(COMPONENTS):
        raise ValueError("Incomplete image manifest")
    for component in COMPONENTS:
        reference = images[component]
        if not isinstance(reference, str) or not re.fullmatch(re.escape(prefix + "-" + component) + r"@sha256:[0-9a-f]{64}", reference):
            raise ValueError("Image must use the expected repository and content digest")
    return source, images


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as stream:
            source_hash, refs = validate(json.load(stream), sys.argv[2], sys.argv[3])
        requested = sys.argv[4:] or list(COMPONENTS)
        if any(component not in COMPONENTS for component in requested):
            raise ValueError("Unknown component")
        print("source\t" + source_hash)
        for component in requested:
            print(component + "\t" + refs[component])
    except (ValueError, TypeError, KeyError, IndexError, OSError):
        sys.exit("Invalid CI release manifest")
