#!/usr/bin/env python3
"""Expose the limited restore operations to the authenticated shop application."""
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import struct
import subprocess
import threading
import time
from datetime import datetime, timezone

ROOT = Path('/opt/3dprinta/shared/restore')
SOCKET = ROOT / 'api/control.sock'
STATUS = ROOT / 'status.json'
CONFIG = Path('/opt/3dprinta/shared/backup')
BACKUP_NAME = re.compile(r'^sidzen-[0-9]{8}T[0-9]{6}Z\.tar\.age$')
JOB_ID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
LOCK = threading.Lock()


def read_status():
    try:
        return json.loads(STATUS.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None


def write_status(value):
    temporary = ROOT / 'status.json.new'
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    os.chmod(temporary, 0o644)
    os.replace(temporary, STATUS)


def backups():
    config = CONFIG / 'yandex-rclone.conf'
    remote = (CONFIG / 'remote-path').read_text(encoding='utf-8').strip()
    if not remote.startswith('sidzen-backup:') or '\n' in remote:
        raise ValueError('Invalid backup location')
    if not (CONFIG / 'restore.agekey').is_file():
        raise ValueError('Recovery key unavailable')
    with open('/var/backups/3dprinta/.backup.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run(
            ['rclone', '--config', str(config), '--contimeout', '10s', '--timeout', '25s',
             'lsjson', '--files-only', '--max-depth', '1', remote],
            capture_output=True, check=True, timeout=35,
        )
    rows = json.loads(result.stdout)
    names = {item['Name'] for item in rows}
    valid = []
    for item in rows:
        name = item['Name']
        if not BACKUP_NAME.fullmatch(name) or item['Size'] <= 0 or name + '.hmac' not in names:
            continue
        try:
            timestamp = datetime.strptime(name[7:23], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        valid.append({'name': name, 'modifiedAt': timestamp.isoformat(), 'size': item['Size']})
    return sorted(valid, key=lambda item: item['name'], reverse=True)


def handle(command):
    with LOCK:
        status = read_status()
        if command.get('action') == 'list':
            return {'backups': backups(), 'operation': status}
        if command.get('action') != 'start' or not JOB_ID.fullmatch(command.get('id', '')) or not BACKUP_NAME.fullmatch(command.get('name', '')):
            return {'error': 'invalid'}
        if status and status.get('id') == command['id']:
            return status
        if status and status.get('status') in ('queued', 'running', 'recovering', 'attention'):
            return {'error': 'busy', 'operation': status}
        if command['name'] not in {item['name'] for item in backups()}:
            return {'error': 'missing'}
        value = {'id': command['id'], 'name': command['name'], 'status': 'queued', 'phase': 'queued'}
        write_status(value)
        unit = 'sidzen-restore-' + command['id']
        launched = subprocess.run(
            ['systemd-run', '--quiet', '--collect', '--unit', unit,
             '/bin/bash', '/opt/3dprinta/current/scripts/restore-production.sh', command['id'], command['name']],
            capture_output=True, timeout=20,
        )
        if launched.returncode:
            value.update(status='failed', phase='start')
            write_status(value)
        return value


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(10)
        _, uid, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid not in (0, 1001):
            return
        try:
            line = self.rfile.readline(4097)
            if len(line) > 4096:
                raise ValueError('Request too large')
            response = handle(json.loads(line))
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            response = {'error': 'unavailable'}
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode() + b'\n')


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def recover_interrupted():
    while True:
        time.sleep(10)
        status = read_status()
        if not status or status.get('status') not in ('queued', 'running', 'recovering'):
            continue
        if time.time() - STATUS.stat().st_mtime < 30:
            continue
        job_id = status.get('id', '')
        if not JOB_ID.fullmatch(job_id):
            continue
        unit = 'sidzen-restore-' + job_id
        if subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=False).returncode == 0:
            continue
        subprocess.run(['/bin/bash', '/opt/3dprinta/current/scripts/restore-production.sh', '--recover', job_id], check=False)


if __name__ == '__main__':
    os.umask(0o077)
    ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    SOCKET.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    if SOCKET.exists():
        SOCKET.unlink()
    threading.Thread(target=recover_interrupted, daemon=True).start()
    with Server(str(SOCKET), Handler) as server:
        os.chown(SOCKET, 0, 1001)
        os.chmod(SOCKET, 0o660)
        server.serve_forever()
