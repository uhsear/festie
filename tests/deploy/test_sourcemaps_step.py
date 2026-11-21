"""Unit tests for deploy.py step 5/5b (web build with maps, source map upload). No network, no SSH."""

import io
import socket
import unittest
from contextlib import redirect_stdout

from test_pre_deploy_dump import FakeClient, deploy, patched_main_deps


class TimeoutClient(FakeClient):
    def exec_command(self, cmd, timeout=None):
        if "sentry-sourcemaps" in cmd:
            self.commands.append(cmd)
            raise socket.timeout()
        return super().exec_command(cmd, timeout)


def run_deploy(client):
    """Stop the deploy at the pm2 restart so the commands up to and including step 5b are recorded."""
    client.failing = (*client.failing, "pm2 restart")
    out = io.StringIO()
    with patched_main_deps(client), redirect_stdout(out):
        with unittest.TestCase().assertRaises(SystemExit):
            deploy.main()
    return out.getvalue()


class SourcemapsStepTest(unittest.TestCase):
    def test_only_the_deploy_web_build_enables_maps(self):
        client = FakeClient()
        run_deploy(client)
        build = next(c for c in client.commands if "@festie/web build" in c)
        self.assertIn("FESTIE_WEB_SOURCEMAPS=1 pnpm --filter @festie/web build", build)
        self.assertEqual([c for c in client.commands if "FESTIE_WEB_SOURCEMAPS" in c], [build])

    def test_upload_command_uses_pipefail(self):
        client = FakeClient()
        run_deploy(client)
        upload = next(c for c in client.commands if "sentry-sourcemaps" in c)
        self.assertIn("set -o pipefail", upload)

    def test_upload_failure_only_warns_and_the_restart_still_runs(self):
        client = FakeClient(failing=("sentry-sourcemaps",))
        out = run_deploy(client)
        self.assertIn("WARNING: source map upload failed", out)
        self.assertTrue(any("pm2 restart" in c for c in client.commands))

    def test_upload_timeout_only_warns_and_the_restart_still_runs(self):
        client = TimeoutClient()
        out = run_deploy(client)
        self.assertIn("WARNING: source map upload failed", out)
        self.assertTrue(any("pm2 restart" in c for c in client.commands))


if __name__ == "__main__":
    unittest.main()
