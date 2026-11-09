import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("relay_changes", Path(__file__).with_name("telegram-relay-change-required.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RelayChangeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "qa@example.test")
        self.git("config", "user.name", "QA")
        self.write("deploy/telegram-relay/Dockerfile", "relay")
        self.write("app.txt", "original")
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE).decode().strip()

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-qm", "test")
        return self.git("rev-parse", "HEAD")

    def check(self, before, after, event="push"):
        original = module.subprocess.run
        def run_with_cwd(*args, **kwargs):
            return original(*args, cwd=self.root, **kwargs)
        with mock.patch.object(module.subprocess, "run", side_effect=run_with_cwd):
            return module.relay_deployment_required(event, before, after)

    def test_unrelated_release_does_not_restart_relay(self):
        self.write("app.txt", "next upgrade")
        self.assertFalse(self.check(self.base, self.commit()))

    def test_multiple_commits_and_relay_scripts(self):
        self.write("scripts/deploy-telegram-relay.sh", "changed")
        self.commit()
        self.write("app.txt", "next upgrade")
        self.assertTrue(self.check(self.base, self.commit()))

    def test_merge_commit_includes_relay_changes_from_both_parents(self):
        main_branch = self.git("branch", "--show-current")
        self.git("checkout", "-qb", "relay-feature")
        self.write("deploy/telegram-relay/Dockerfile", "changed")
        self.commit()
        self.git("checkout", "-q", main_branch)
        self.write("app.txt", "main change")
        self.commit()
        self.git("merge", "--no-ff", "-qm", "merge", "relay-feature")
        self.assertTrue(self.check(self.base, self.git("rev-parse", "HEAD")))

    def test_relay_deletion_and_move_out(self):
        (self.root / "deploy/telegram-relay/Dockerfile").unlink()
        self.write("moved/Dockerfile", "relay")
        self.assertTrue(self.check(self.base, self.commit()))

    def test_relay_creation_and_move_in(self):
        self.write("deploy/telegram-relay/new.py", "new")
        self.assertTrue(self.check(self.base, self.commit()))

    def test_shared_provision_and_manifest_changes(self):
        for path in ("scripts/provision-docker-host.sh", "scripts/registry-release-manifest.py"):
            with self.subTest(path=path):
                self.write(path, "changed")
                self.assertTrue(self.check(self.base, self.commit()))

    def test_dispatch_and_unavailable_history_fail_safe(self):
        self.assertTrue(self.check(self.base, self.base, "workflow_dispatch"))
        self.assertTrue(self.check("0" * 40, self.base))
        self.assertTrue(self.check("f" * 40, self.base))
        self.assertTrue(self.check("", self.base))

    def test_git_failure_fails_safe(self):
        with mock.patch.object(module.subprocess, "run", side_effect=OSError("git unavailable")):
            self.assertTrue(module.relay_deployment_required("push", self.base, self.base))


if __name__ == "__main__":
    unittest.main()
