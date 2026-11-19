"""Characterization tests for main() in scripts/deploy/deploy.py.

paramiko is stubbed and connect()/run() are replaced, so no test opens a
network connection or runs a command on any host.

Run: python -m unittest discover -s tests/deploy -p "test_*.py"
"""

import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from test_pre_deploy_dump import deploy


class FakeClient:
    closed = False

    def close(self):
        self.closed = True


def run_main(fail_on=None, ready="200", creds=("user", "pw")):
    """Run deploy.main() with every SSH command recorded. Returns (commands, exit, client)."""
    commands = []

    def fake_run(client, cmd, timeout=300):
        commands.append(cmd)
        if fail_on and fail_on in cmd:
            return 1, "", "boom"
        if "%{http_code}" in cmd and "/api/ready" in cmd:
            return 0, ready, ""
        if "%{http_code}" in cmd:
            return 0, "200", ""
        return 0, "ok", ""

    client = FakeClient()
    exit_value = None
    with mock.patch.object(deploy, "connect", return_value=client), \
            mock.patch.object(deploy, "run", fake_run), \
            mock.patch.object(deploy, "pre_deploy_dump", lambda c: commands.append("DUMP")), \
            mock.patch.object(deploy, "TEST_USER", creds[0]), \
            mock.patch.object(deploy, "TEST_PASSWORD", creds[1]), \
            redirect_stdout(io.StringIO()):
        try:
            deploy.main()
        except SystemExit as exc:
            exit_value = exc.code
    return commands, exit_value, client


class DeployMainTest(unittest.TestCase):
    def test_happy_path_order_and_client_closed(self):
        commands, exit_value, client = run_main()
        self.assertIsNone(exit_value)
        self.assertTrue(client.closed)
        markers = ["DUMP", "git reset --hard origin/main", "npm install", "npm run build",
                   "@festie/web build", "pm2 restart festie", "/api/ready", "/auth/login",
                   "git tag deploy-"]
        positions = [next(i for i, c in enumerate(commands) if m in c) for m in markers]
        self.assertEqual(positions, sorted(positions))

    def test_dump_runs_before_any_other_command(self):
        commands, _, _ = run_main()
        self.assertEqual(commands[0], "DUMP")

    def test_each_failing_step_aborts_before_restart(self):
        for marker, message in [
            ("git reset --hard", "git sync failed"),
            ("npm install", "dependency install failed"),
            ("npm run build", "backend bundle build failed"),
            ("@festie/web build", "web build failed"),
        ]:
            with self.subTest(step=marker):
                commands, exit_value, client = run_main(fail_on=marker)
                self.assertEqual(exit_value, message)
                self.assertFalse(any("pm2 restart" in c for c in commands))
                self.assertTrue(client.closed)

    def test_not_ready_aborts_without_tagging(self):
        commands, exit_value, _ = run_main(ready="503")
        self.assertIn("503", exit_value)
        self.assertFalse(any("git tag" in c for c in commands))

    def test_login_skipped_without_credentials(self):
        commands, exit_value, _ = run_main(creds=(None, None))
        self.assertIsNone(exit_value)
        self.assertFalse(any("/auth/login" in c for c in commands))

    def test_pm2_restart_exit_is_not_checked(self):
        # Characterizes a known gap: a failed pm2 restart does not abort; only
        # the readiness gate catches it.
        commands, exit_value, _ = run_main(fail_on="pm2 restart")
        self.assertIsNone(exit_value)
        self.assertTrue(any("git tag" in c for c in commands))

    def test_login_temp_file_uses_unescaped_shell_pid(self):
        # Characterizes a known bug: "$$" is expanded by each separate remote
        # shell, so the write and the curl use different file names.
        commands, _, _ = run_main()
        write = next(c for c in commands if "cat >" in c)
        self.assertIn("/tmp/festie-login.$$.json", write)
        curl = next(c for c in commands if "-X POST" in c)
        self.assertIn("-d @/tmp/festie-login.$$.json", curl)
        self.assertNotIn("pw", curl)

    def test_failed_tag_push_does_not_raise(self):
        _, exit_value, _ = run_main(fail_on="git tag")
        self.assertIsNone(exit_value)


if __name__ == "__main__":
    unittest.main()
