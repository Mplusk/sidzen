import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("nginx-shop-idn.sh")
ROOT = SCRIPT.parent.parent


class DomainConfigurationTest(unittest.TestCase):
    def test_idn_routes_match_the_requested_domain_and_preserve_the_path(self):
        domain = "сидзэн.рф".encode("idna").decode("ascii")
        self.assertEqual(domain, "xn--d1agbwq9e.xn--p1ai")
        caddy = (ROOT / "deploy/caddy/Caddyfile").read_text()
        nginx = (ROOT / "deploy/nginx/ispmanager-sidzen-idn.conf").read_text()
        self.assertIn(f"{domain}, www.{domain} {{", caddy)
        self.assertIn("redir https://sidzen.shop{uri} permanent", caddy)
        self.assertIn(f"server_name {domain} www.{domain};", nginx)
        self.assertIn("proxy_pass http://127.0.0.1:8080;", nginx)


class NginxAliasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.bin = root / "bin"
        self.bin.mkdir()
        self.state = root / "state"
        self.state.mkdir()
        self.desired = root / "desired.conf"
        self.desired.write_text("# managed alias\n")
        self.previous = root / "previous.conf"
        self.previous.write_text("# previous alias\n")
        self.target = root / "shop-idn.conf"
        self.dump = root / "nginx-dump"
        self.dump.write_text("server_name other.example;\n")
        self.fail = root / "fail-once"
        nginx = self.bin / "nginx"
        nginx.write_text('#!/bin/sh\nif [ "$1" = "-T" ]; then cat "$NGINX_TEST_DUMP"; exit 0; fi\nif [ -f "$NGINX_TEST_FAIL" ]; then rm "$NGINX_TEST_FAIL"; exit 1; fi\nexit 0\n')
        nginx.chmod(0o755)
        systemctl = self.bin / "systemctl"
        systemctl.write_text("#!/bin/sh\nexit 0\n")
        systemctl.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "NGINX_TEST_DUMP": str(self.dump), "NGINX_TEST_FAIL": str(self.fail)}

    def run_script(self, mode):
        return subprocess.run(["bash", str(SCRIPT), mode, str(self.desired), str(self.target), str(self.previous), str(self.state)], env=self.env, capture_output=True, text=True)

    def test_adds_and_restores_a_new_route(self):
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.target.read_text(), self.desired.read_text())
        self.assertEqual(self.run_script("restore").returncode, 0)
        self.assertFalse(self.target.exists())

    def test_restores_previous_route_and_preserves_independent_changes(self):
        self.target.write_text(self.previous.read_text())
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.target.write_text("# changed by another service\n")
        self.assertNotEqual(self.run_script("restore").returncode, 0)
        self.assertEqual(self.target.read_text(), "# changed by another service\n")

    def test_restores_the_original_version_after_a_later_failure(self):
        self.target.write_text(self.previous.read_text())
        self.assertEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.run_script("restore").returncode, 0)
        self.assertEqual(self.target.read_text(), self.previous.read_text())

    def test_rejects_an_unmanaged_existing_file(self):
        self.target.write_text("# independently managed\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertEqual(self.target.read_text(), "# independently managed\n")

    def test_rejects_a_hostname_already_used_by_another_server(self):
        self.dump.write_text("server_name xn--d1agbwq9e.xn--p1ai;\n")
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertFalse(self.target.exists())

    def test_failed_nginx_validation_restores_the_old_state(self):
        self.fail.touch()
        self.assertNotEqual(self.run_script("apply").returncode, 0)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.state / "changed").exists())


if __name__ == "__main__":
    unittest.main()
