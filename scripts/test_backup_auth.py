import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('backup_auth', SCRIPT_DIR / 'backup-auth.py')
backup_auth = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup_auth)


def nested(name='fixture.txt', content=b'fixture'):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        entry = tarfile.TarInfo(name)
        entry.size = len(content)
        archive.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def archive(model_name='fixture.txt', corrupt=False):
    entries = {
        'database.dump': b'PGDMP' + b'fixture',
        'model-files.tar.gz': nested(model_name),
        'product-images.tar.gz': nested(),
        'privacy-ledger.tar.gz': nested(),
        'configuration.tar.gz': nested(),
        'release.txt': b'1' * 40 + b'\n',
    }
    lines = [f'{hashlib.sha256(value).hexdigest()}  {name}\n' for name, value in entries.items()]
    entries['SHA256SUMS'] = ''.join(lines).encode()
    if corrupt:
        entries['database.dump'] += b'tampered'
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as result:
        for name, value in entries.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(value)
            result.addfile(entry, io.BytesIO(value))
    return output.getvalue()


class BackupAuthentication(unittest.TestCase):
    def test_tampering_fails_authentication(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            identity = directory / 'key'
            identity.write_text('# fixture only\nAGE-SECRET-KEY-1FIXTURE\n')
            payload = directory / 'archive'
            payload.write_bytes(b'encrypted fixture')
            signed = backup_auth.signature(identity, payload)
            payload.write_bytes(b'encrypted fixture changed')
            self.assertNotEqual(signed, backup_auth.signature(identity, payload))

    def test_checksum_and_nested_paths_are_checked_before_use(self):
        for payload, expected in [(archive(), 0), (archive(corrupt=True), 1), (archive('../outside'), 1)]:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as folder:
                process = subprocess.run([sys.executable, str(SCRIPT_DIR / 'extract-restore-backup.py'), folder],
                                         input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertEqual(process.returncode, expected, process.stderr.decode())


if __name__ == '__main__':
    unittest.main()
