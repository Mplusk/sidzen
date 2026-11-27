#!/usr/bin/env python3
"""Check aggregate expansion space on the actual destination filesystems."""
import os
from pathlib import Path
import shutil
import sys
import tarfile

HEADROOM = 512 * 1024 * 1024


def check(archive_dir, destinations):
    devices = {}
    for name, destination in zip(('model-files.tar.gz', 'product-images.tar.gz'), destinations, strict=True):
        target = Path(destination)
        device = os.stat(target).st_dev
        if device not in devices:
            devices[device] = [shutil.disk_usage(target).free, 0]
        with tarfile.open(Path(archive_dir) / name, 'r:gz') as archive:
            devices[device][1] += sum(member.size for member in archive if member.isfile())
    if any(free < required + HEADROOM for free, required in devices.values()):
        raise ValueError('Not enough free space to replace uploaded files safely')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('Expected the archive directory and two volume paths')
        check(sys.argv[1], sys.argv[2:])
    except (OSError, ValueError, tarfile.TarError) as error:
        print(f'Restore space check failed: {error}', file=sys.stderr)
        sys.exit(1)
