#!/usr/bin/env python3
"""Persist restore progress outside the database being restored."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

root = Path('/opt/3dprinta/shared/restore')
job, name, status, phase = sys.argv[1:5]
record = {'id': job, 'name': name, 'status': status, 'phase': phase,
          'updatedAt': datetime.now(timezone.utc).isoformat()}
temporary = root / 'status.json.new'
with open(temporary, 'w', encoding='utf-8') as output:
    output.write(json.dumps(record)); output.flush(); os.fsync(output.fileno())
os.chmod(temporary, 0o644)
os.replace(temporary, root / 'status.json')
directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
try: os.fsync(directory)
finally: os.close(directory)
