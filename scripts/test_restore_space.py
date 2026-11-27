import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('restore_space', Path(__file__).with_name('check-restore-space.py'))
restore_space = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore_space)


class RestoreSpace(unittest.TestCase):
    def test_files_on_same_disk_are_counted_together(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('model-files.tar.gz', 'product-images.tar.gz'):
                with tarfile.open(Path(folder) / name, 'w:gz') as archive:
                    item = tarfile.TarInfo('fixture')
                    item.size = 100
                    archive.addfile(item, io.BytesIO(b'x' * 100))
            with patch.object(restore_space.shutil, 'disk_usage') as usage:
                usage.return_value.free = restore_space.HEADROOM + 150
                with self.assertRaises(ValueError):
                    restore_space.check(folder, (folder, folder))
                usage.return_value.free = restore_space.HEADROOM + 200
                restore_space.check(folder, (folder, folder))


if __name__ == '__main__':
    unittest.main()
