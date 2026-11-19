"""Unit tests for wait_ready and smoke_login in scripts/deploy/deploy.py.

Every SSH command goes to a fake runner; nothing opens a network connection.
"""

import unittest
from unittest import mock

from test_pre_deploy_dump import deploy


class WaitReadyTest(unittest.TestCase):
    def test_retries_until_200(self):
        codes = iter(["000", "503", "200"])
        runner = mock.Mock(side_effect=lambda c, cmd, timeout=300: (0, next(codes), ""))
        with mock.patch.object(deploy.time, "sleep") as sleep:
            self.assertEqual(deploy.wait_ready(object(), runner=runner), "200")
        self.assertEqual(runner.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_returns_last_code_when_never_ready(self):
        runner = mock.Mock(return_value=(0, "503", ""))
        with mock.patch.object(deploy.time, "sleep"):
            self.assertEqual(deploy.wait_ready(object(), runner=runner, attempts=3), "503")
        self.assertEqual(runner.call_count, 3)


class SmokeLoginTest(unittest.TestCase):
    def test_write_curl_and_cleanup_share_one_command(self):
        runner = mock.Mock(return_value=(0, "200", ""))
        with mock.patch.multiple(deploy, TEST_USER="u", TEST_PASSWORD="p"):
            self.assertEqual(deploy.smoke_login(object(), runner=runner), "200")
        runner.assert_called_once()
        cmd = runner.call_args.args[1]
        self.assertIn("cat > /tmp/festie-login.$$.json", cmd)
        self.assertIn("-d @/tmp/festie-login.$$.json", cmd)
        self.assertIn("trap 'rm -f /tmp/festie-login.$$.json' EXIT", cmd)


if __name__ == "__main__":
    unittest.main()
