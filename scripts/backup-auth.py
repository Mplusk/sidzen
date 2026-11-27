#!/usr/bin/env python3
"""Authenticate encrypted backups using the separately held age identity."""
import hashlib
import hmac
from pathlib import Path
import re
import sys


def signature(identity, archive):
    lines = [line.strip() for line in Path(identity).read_bytes().splitlines() if line.startswith(b'AGE-SECRET-KEY-')]
    if len(lines) != 1:
        raise ValueError('Expected one age identity')
    key = hashlib.sha256(b'SIDZEN backup authentication v1\x00' + lines[0]).digest()
    digest = hmac.new(key, digestmod=hashlib.sha256)
    with open(archive, 'rb') as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'sign':
            print(signature(sys.argv[2], sys.argv[3]))
        elif len(sys.argv) == 5 and sys.argv[1] == 'verify':
            expected = Path(sys.argv[4]).read_text(encoding='ascii').strip()
            if not re.fullmatch(r'[0-9a-f]{64}', expected) or not hmac.compare_digest(expected, signature(sys.argv[2], sys.argv[3])):
                raise ValueError('Backup authentication failed')
        else:
            raise ValueError('Invalid backup authentication command')
    except (OSError, UnicodeError, ValueError) as error:
        print(f'Backup authentication failed: {error}', file=sys.stderr)
        sys.exit(1)
