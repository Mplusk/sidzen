import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("manifest", pathlib.Path(__file__).with_name("registry-release-manifest.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.revision = "a" * 40
        self.prefix = "ghcr.io/cossomoj/sidzen"
        self.data = {"version": 1, "revision": self.revision, "sourceSha256": "b" * 64, "images": {key: self.prefix + "-" + key + "@sha256:" + "c" * 64 for key in module.COMPONENTS}}

    def test_accepts_only_the_exact_verified_release(self):
        self.assertEqual(module.validate(self.data, self.revision, self.prefix)[0], "b" * 64)

    def test_accepts_images_from_the_migrated_registry(self):
        prefix = "ghcr.io/mplusk/sidzen"
        data = copy.deepcopy(self.data)
        data["images"] = {key: prefix + "-" + key + "@sha256:" + "c" * 64 for key in module.COMPONENTS}
        self.assertEqual(module.validate(data, self.revision, prefix)[0], "b" * 64)
        with self.assertRaises(ValueError):
            module.validate(data, self.revision, self.prefix)

    def test_rejects_tags_other_registries_and_wrong_components(self):
        for ref in [self.prefix + "-app:latest", "ghcr.io/attacker/app@sha256:" + "c" * 64, self.data["images"]["migrate"], self.data["images"]["app"] + "\ncommand"]:
            data = copy.deepcopy(self.data)
            data["images"]["app"] = ref
            with self.assertRaises(ValueError):
                module.validate(data, self.revision, self.prefix)

    def test_rejects_incomplete_or_different_release(self):
        for changes in [{"revision": "d" * 40}, {"sourceSha256": ""}, {"images": {}}, {"version": 2}]:
            with self.assertRaises(ValueError):
                module.validate({**self.data, **changes}, self.revision, self.prefix)


if __name__ == "__main__":
    unittest.main()
