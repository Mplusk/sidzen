#!/usr/bin/env python3
"""Authenticate older cloud copies only when they match a local server backup."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

CONFIG = Path('/opt/3dprinta/shared/backup')
LOCAL = Path('/var/backups/3dprinta')
SCRIPTS = Path(__file__).resolve().parent
NAME = re.compile(r'^sidzen-([0-9]{8}T[0-9]{6}Z)\.tar\.age$')
os.umask(0o077)


def run(arguments, **kwargs):
    return subprocess.run(arguments, check=True, timeout=180, **kwargs)


def main():
    remote = (CONFIG / 'remote-path').read_text().strip()
    if not remote.startswith('sidzen-backup:') or '\n' in remote:
        raise ValueError('Invalid backup location')
    options = ['rclone', '--config', str(CONFIG / 'yandex-rclone.conf'), '--contimeout', '15s', '--timeout', '2m', '--retries', '3']
    with open(LOCAL / '.backup.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        rows = json.loads(run(options + ['lsjson', '--files-only', '--max-depth', '1', remote], capture_output=True).stdout)
        names = {item['Name'] for item in rows}
        for row in rows:
            name = row['Name']
            match = NAME.fullmatch(name)
            if not match or name + '.hmac' in names:
                continue
            local = LOCAL / match[1]
            if not (local / 'SHA256SUMS').is_file():
                print(f'Skipped {name}: local comparison is unavailable.')
                continue
            checked = subprocess.run(['sha256sum', '--check', '--status', 'SHA256SUMS'], cwd=local, check=False)
            if checked.returncode:
                print(f'Skipped {name}: the local backup failed verification.')
                continue
            size = row['Size']
            if not isinstance(size, int) or size <= 0 or size + 536870912 >= shutil.disk_usage(LOCAL).free:
                raise ValueError('Not enough space to verify an existing backup')
            with tempfile.TemporaryDirectory(prefix='.attest.', dir=LOCAL) as temporary:
                directory = Path(temporary)
                encrypted = directory / 'backup.age'
                extracted = directory / 'archive'
                extracted.mkdir(mode=0o700)
                with encrypted.open('wb') as output:
                    run(options + ['cat', remote.rstrip('/') + '/' + name], stdout=output)
                if encrypted.stat().st_size != size:
                    raise ValueError('Incomplete encrypted backup download')
                decrypt = subprocess.Popen(['age', '--decrypt', '-i', str(CONFIG / 'restore.agekey'), str(encrypted)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                try:
                    verified = subprocess.run([sys.executable, str(SCRIPTS / 'extract-restore-backup.py'), str(extracted)], stdin=decrypt.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
                finally:
                    decrypt.stdout.close()
                decrypt_result = decrypt.wait(timeout=180)
                if verified.returncode or decrypt_result:
                    print(f'Skipped {name}: the encrypted backup could not be verified.')
                    continue
                if (extracted / 'SHA256SUMS').read_bytes() != (local / 'SHA256SUMS').read_bytes():
                    print(f'Skipped {name}: local and remote backup contents differ.')
                    continue
                signature = directory / 'signature'
                with signature.open('wb') as output:
                    run([sys.executable, str(SCRIPTS / 'backup-auth.py'), 'sign', str(CONFIG / 'restore.agekey'), str(encrypted), name], stdout=output)
                destination = remote.rstrip('/') + '/' + name + '.hmac'
                run(options + ['copyto', '--immutable', '--checksum', str(signature), destination], stdout=subprocess.DEVNULL)
                uploaded = run(options + ['cat', destination], capture_output=True).stdout
                if uploaded != signature.read_bytes():
                    raise ValueError('Uploaded backup signature did not match')
                print(f'Authenticated {name}.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print(f'Backup enrollment failed: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
