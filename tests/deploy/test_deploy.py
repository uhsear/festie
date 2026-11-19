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


class FakeStream:
    def __init__(self, text, exit_code=0):
        self._text = text
        self.channel = mock.Mock(recv_exit_status=lambda: exit_code)

    def read(self):
        return self._text.encode()


class FakeClient:
    """Stands in for paramiko.SSHClient; answers each command via `respond`."""

    closed = False

    def __init__(self, respond):
        self.respond = respond

    def exec_command(self, cmd, timeout=None):
        code, out, err = self.respond(cmd)
        return None, FakeStream(out, code), FakeStream(err)

    def close(self):
        self.closed = True


def run_main(fail_on=None, ready="200", creds=("user", "pw")):
    """Run deploy.main() with every SSH command recorded. Returns (commands, exit, client)."""
    commands = []

    def respond(cmd):
        commands.append(cmd)
        if fail_on and fail_on in cmd:
            return 1, "", "boom"
        if "%{http_code}" in cmd and "/api/ready" in cmd:
            return 0, ready, ""
        if "%{http_code}" in cmd:
            return 0, "200", ""
        return 0, "ok", ""

    client = FakeClient(respond)
    exit_value = None
    # wait_ready and smoke_login bind run() as a default argument, so the fake
    # sits at the client layer (exec_command) rather than patching deploy.run.
    with mock.patch.object(deploy, "connect", return_value=client),             mock.patch.object(deploy, "pre_deploy_dump", lambda c: commands.append("DUMP")),             mock.patch.object(deploy.time, "sleep"),             mock.patch.object(deploy, "TEST_USER", creds[0]),             mock.patch.object(deploy, "TEST_PASSWORD", creds[1]),             redirect_stdout(io.StringIO()):
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
        markers = ["DUMP", "git reset --hard origin/main", "npm ci", "npm run build",
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
            ("npm ci", "dependency install failed"),
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

    def test_failed_pm2_restart_aborts_before_readiness_and_tag(self):
        commands, exit_value, client = run_main(fail_on="pm2 restart")
        self.assertEqual(exit_value, "pm2 restart failed; the old process may still be serving")
        self.assertFalse(any("/api/ready" in c for c in commands))
        self.assertFalse(any("git tag" in c for c in commands))
        self.assertTrue(client.closed)

    def test_login_write_curl_and_cleanup_share_one_remote_shell(self):
        # "$$" is only stable within one remote shell, so the write, the curl
        # and the trap cleanup must be a single command.
        commands, _, _ = run_main()
        logins = [c for c in commands if "-X POST" in c]
        self.assertEqual(len(logins), 1)
        cmd = logins[0]
        self.assertIn("cat > /tmp/festie-login.$$.json", cmd)
        self.assertIn("-d @/tmp/festie-login.$$.json", cmd)
        self.assertIn("trap 'rm -f /tmp/festie-login.$$.json' EXIT", cmd)
        curl_line = next(line for line in cmd.splitlines() if line.startswith("curl"))
        self.assertNotIn("pw", curl_line)

    def test_failed_tag_push_does_not_raise(self):
        _, exit_value, _ = run_main(fail_on="git tag")
        self.assertIsNone(exit_value)


class ConnectHostKeyTest(unittest.TestCase):
    def test_connect_rejects_unknown_host_keys(self):
        client = mock.Mock()
        fake_paramiko = mock.Mock(SSHClient=mock.Mock(return_value=client))
        with mock.patch.object(deploy, "paramiko", fake_paramiko), mock.patch.object(
            deploy, "KNOWN_HOSTS", "extra_known_hosts"
        ):
            deploy.connect()
        client.load_system_host_keys.assert_called_once_with()
        client.load_host_keys.assert_called_once_with("extra_known_hosts")
        client.set_missing_host_key_policy.assert_called_once_with(fake_paramiko.RejectPolicy())
        fake_paramiko.AutoAddPolicy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
