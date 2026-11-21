"""Unit test that scripts/deploy/verify.py main() runs the smoke checks and fails on their failures.

Standard library only. paramiko is stubbed and every SSH command goes to a fake client.
"""

import importlib.util
import io
import os
import sys
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

VERIFY_PY = Path(__file__).resolve().parents[2] / "scripts" / "deploy" / "verify.py"


class FakeChannel:
    def recv_exit_status(self):
        return 0


class FakeStream:
    def __init__(self, text):
        self.text = text
        self.channel = FakeChannel()

    def read(self):
        return self.text.encode()


class FakeClient:
    def exec_command(self, cmd, timeout=None):
        out = "online" if cmd.startswith("pm2") else "200"
        return None, FakeStream(out), FakeStream("")

    def close(self):
        pass


def load_verify(extra_env=None):
    spec = importlib.util.spec_from_file_location("festie_verify_under_test", VERIFY_PY)
    module = importlib.util.module_from_spec(spec)
    env = {"FESTIE_SSH_HOST": "host.invalid", "FESTIE_SSH_USER": "user", "FESTIE_APP_DIR": "/app", **(extra_env or {})}
    with mock.patch.dict(os.environ, env), mock.patch.dict(sys.modules, {"paramiko": types.ModuleType("paramiko")}):
        spec.loader.exec_module(module)
    return module


class VerifyMainTest(unittest.TestCase):
    def run_main(self, verify, smoke_failures):
        with mock.patch.object(verify, "connect", return_value=FakeClient()), mock.patch.object(
            verify, "run_smoke", return_value=smoke_failures
        ) as run_smoke, redirect_stdout(io.StringIO()) as out:
            try:
                verify.main()
                code = 0
            except SystemExit as exc:
                code = exc.code
        return code, run_smoke, out.getvalue()

    def test_main_runs_smoke_against_the_app_base_url(self):
        verify = load_verify({"FESTIE_SMOKE_USER": "u", "FESTIE_SMOKE_PASSWORD": "p"})
        code, run_smoke, out = self.run_main(verify, [])
        self.assertEqual(code, 0)
        self.assertIn("Verify OK", out)
        args = run_smoke.call_args.args
        self.assertEqual(args[1:], ("http://localhost:4000", verify.LOGIN_URL, "u", "p"))

    def test_smoke_failure_fails_the_verify(self):
        code, _, out = self.run_main(load_verify(), ["JS entry /assets/index-x.js returned 404"])
        self.assertEqual(code, 1)
        self.assertIn("index-x.js returned 404", out)
        self.assertNotIn("Verify OK", out)

    def test_test_credentials_are_the_fallback(self):
        verify = load_verify({"FESTIE_TEST_USER": "tu", "FESTIE_TEST_PASSWORD": "tp"})
        self.assertEqual((verify.SMOKE_USER, verify.SMOKE_PASSWORD), ("tu", "tp"))


if __name__ == "__main__":
    unittest.main()
