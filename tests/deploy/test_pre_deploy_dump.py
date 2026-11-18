"""Unit tests for pre_deploy_dump in scripts/deploy/deploy.py.

Standard library only. paramiko is stubbed in sys.modules, and every SSH command
goes to a fake client, so nothing here opens a network connection.

Run: python -m unittest discover -s tests/deploy -p "test_*.py"
"""

import importlib.util
import io
import socket
import sys
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

DEPLOY_PY = Path(__file__).resolve().parents[2] / "scripts" / "deploy" / "deploy.py"


def load_deploy():
    spec = importlib.util.spec_from_file_location("festie_deploy_under_test", DEPLOY_PY)
    module = importlib.util.module_from_spec(spec)
    # The stub lives only while deploy.py imports, so a real paramiko used by
    # another test in the same process is not shadowed.
    with mock.patch.dict(sys.modules, {"paramiko": types.ModuleType("paramiko")}):
        spec.loader.exec_module(module)
    return module


deploy = load_deploy()


class FakeClient:
    """Records every command. Commands containing a failing marker exit 1."""

    def __init__(self, failing=()):
        self.commands = []
        self.failing = failing
        self.closed = False

    def exec_command(self, cmd, timeout=None):
        self.commands.append(cmd)
        code = 1 if any(marker in cmd for marker in self.failing) else 0
        channel = mock.Mock()
        channel.recv_exit_status.return_value = code
        out = mock.Mock(channel=channel)
        out.read.return_value = b""
        err = mock.Mock()
        err.read.return_value = b"pg_dump: connection refused" if code else b""
        return None, out, err

    def close(self):
        self.closed = True


class PreDeployDumpTest(unittest.TestCase):
    def test_failing_dump_raises_system_exit(self):
        calls = []

        def runner(client, cmd, timeout=300):
            calls.append(cmd)
            return 1, "", "pg_dump: connection refused"

        with redirect_stdout(io.StringIO()) as printed:
            with self.assertRaises(SystemExit) as raised:
                deploy.pre_deploy_dump(object(), runner=runner)
        self.assertIn("pre-deploy dump failed", str(raised.exception))
        self.assertIn("connection refused", printed.getvalue())
        self.assertEqual(len(calls), 1)
        self.assertIn("scripts/backup-pg.sh", calls[0])
        self.assertIn(deploy.APP, calls[0])

    def test_passing_dump_returns(self):
        with redirect_stdout(io.StringIO()):
            result = deploy.pre_deploy_dump(object(), runner=lambda client, cmd, timeout=300: (0, "Backup OK", ""))
        self.assertIsNone(result)

    def test_timeout_raises_the_same_system_exit(self):
        def runner(client, cmd, timeout=300):
            raise socket.timeout("timed out")

        with redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                deploy.pre_deploy_dump(object(), runner=runner)
        self.assertIn("pre-deploy dump failed", str(raised.exception))

    def test_corrupt_dump_warning_fails_even_with_exit_zero(self):
        log = "WARNING: pg_restore --list failed -- dump may be corrupt"
        with redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                deploy.pre_deploy_dump(object(), runner=lambda client, cmd, timeout=300: (0, log, ""))
        self.assertIn("pre-deploy dump failed", str(raised.exception))

    def test_failing_dump_stops_main_before_git_or_pm2(self):
        client = FakeClient(failing=("backup-pg.sh",))
        with mock.patch.object(deploy, "connect", return_value=client):
            with redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit):
                    deploy.main()
        self.assertEqual(len(client.commands), 1)
        self.assertIn("backup-pg.sh", client.commands[0])
        for cmd in client.commands:
            self.assertNotIn("git", cmd)
            self.assertNotIn("pm2", cmd)
        self.assertTrue(client.closed)

    def test_dump_runs_before_the_git_sync(self):
        client = FakeClient(failing=("git fetch",))
        with mock.patch.object(deploy, "connect", return_value=client):
            with redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit):
                    deploy.main()
        self.assertIn("backup-pg.sh", client.commands[0])
        self.assertIn("git fetch", client.commands[1])


if __name__ == "__main__":
    unittest.main()
