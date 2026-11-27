#!/usr/bin/env python3
"""Validate and stage an age-decrypted SIDZEN backup from standard input."""
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile


FILES = {
    "database.dump",
    "model-files.tar.gz",
    "product-images.tar.gz",
    "privacy-ledger.tar.gz",
    "configuration.tar.gz",
    "release.txt",
    "SHA256SUMS",
}


def checked_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("Unsafe archive path")
    return str(path)


def check_nested_archive(path):
    expanded = 0
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            checked_name(member.name)
            if not (member.isfile() or member.isdir()):
                raise ValueError("Archive contains an unsupported entry")
            expanded += member.size
            if expanded > shutil.disk_usage(path.parent).free - 536870912:
                raise ValueError("Insufficient disk space to restore uploaded files")


def extract(destination):
    hashes = {}
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as archive:
        for member in archive:
            name = checked_name(member.name)
            if name == "." and member.isdir():
                continue
            if name not in FILES or name in hashes or not member.isfile():
                raise ValueError("Unexpected or duplicate backup entry")
            if member.size > shutil.disk_usage(destination).free - 536870912:
                raise ValueError("Insufficient disk space for staging")
            digest = hashlib.sha256()
            source = archive.extractfile(member)
            with open(destination / name, "xb") as output:
                while block := source.read(1024 * 1024):
                    digest.update(block)
                    output.write(block)
            hashes[name] = digest.hexdigest()
    if set(hashes) != FILES:
        raise ValueError("Backup is incomplete")
    lines = (destination / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    expected = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64}) [ *]([^/]+)", line)
        if not match or match[2] in expected or match[2] not in FILES - {"SHA256SUMS"}:
            raise ValueError("Invalid backup checksum manifest")
        expected[match[2]] = match[1]
    if expected != {name: digest for name, digest in hashes.items() if name != "SHA256SUMS"}:
        raise ValueError("Backup checksum mismatch")
    with open(destination / "database.dump", "rb") as database:
        if database.read(5) != b"PGDMP":
            raise ValueError("Invalid PostgreSQL dump")
    revision = (destination / "release.txt").read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid backup release")
    for name in ("model-files.tar.gz", "product-images.tar.gz", "privacy-ledger.tar.gz"):
        check_nested_archive(destination / name)
    print("Backup decrypted and verified.")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        if len(sys.argv) != 2:
            raise ValueError("Expected a staging directory")
        target = Path(sys.argv[1])
        if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
            raise ValueError("Expected an empty staging directory")
        extract(target)
    except (OSError, ValueError, tarfile.TarError, UnicodeError) as error:
        print(f"Backup validation failed: {error}", file=sys.stderr)
        sys.exit(1)
