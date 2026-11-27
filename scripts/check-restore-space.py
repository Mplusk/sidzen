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


def check_database(destination, live_size, dump_size):
    live_size, dump_size = int(live_size), int(dump_size)
    if live_size <= 0 or dump_size <= 0:
        raise ValueError('Invalid database size')
    # A compressed custom dump can expand considerably. Keep room for both the
    # candidate and write-ahead log while the existing database remains intact.
    required = max(live_size * 2, dump_size * 8) + HEADROOM
    if shutil.disk_usage(destination).free < required:
        raise ValueError('Not enough free space to stage a separate database')


if __name__ == '__main__':
    try:
        if len(sys.argv) == 5 and sys.argv[1] == 'files':
            check(sys.argv[2], sys.argv[3:])
        elif len(sys.argv) == 5 and sys.argv[1] == 'database':
            check_database(*sys.argv[2:])
        else:
            raise ValueError('Expected a database or files space check')
    except (OSError, ValueError, tarfile.TarError) as error:
        print(f'Restore space check failed: {error}', file=sys.stderr)
        sys.exit(1)
