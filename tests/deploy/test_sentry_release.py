"""Unit tests for sentry_release_marker in scripts/deploy/deploy.py. No network: urlopen is a fake."""

import io
import json
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest import mock

from test_pre_deploy_dump import deploy

SHA = "a" * 40
ENV = {"SENTRY_AUTH_TOKEN": "tok-secret", "SENTRY_ORG": "my org", "SENTRY_PROJECT": "proj"}


def fake_urlopen(status=201):
    calls = []

    def urlopen(request, timeout=None):
        calls.append(request)
        response = mock.MagicMock()
        response.__enter__.return_value.status = status
        return response

    urlopen.calls = calls
    return urlopen


def run_marker(**kwargs):
    out = io.StringIO()
    with redirect_stdout(out):
        result = deploy.sentry_release_marker(SHA, "deploy-1", **kwargs)
    return result, out.getvalue()


class SentryReleaseMarkerTest(unittest.TestCase):
    def test_skipped_without_all_three_vars(self):
        for missing in ENV:
            urlopen = fake_urlopen()
            env = {k: v for k, v in ENV.items() if k != missing}
            result, out = run_marker(env=env, urlopen=urlopen)
            self.assertFalse(result)
            self.assertEqual(urlopen.calls, [])
            self.assertIn("skipped", out)

    def test_creates_release_then_deploy_with_bearer_token(self):
        urlopen = fake_urlopen()
        result, out = run_marker(env=ENV, urlopen=urlopen)
        self.assertTrue(result)
        release, marker = urlopen.calls
        self.assertEqual(release.full_url, "https://sentry.io/api/0/organizations/my%20org/releases/")
        self.assertEqual(json.loads(release.data), {"version": SHA, "projects": ["proj"]})
        self.assertEqual(marker.full_url, f"https://sentry.io/api/0/organizations/my%20org/releases/{SHA}/deploys/")
        self.assertEqual(json.loads(marker.data), {"environment": "production", "name": "deploy-1"})
        self.assertEqual(release.get_header("Authorization"), "Bearer tok-secret")
        self.assertNotIn("tok-secret", out)

    def test_failure_only_warns(self):
        def boom(request, timeout=None):
            raise urllib.error.URLError("no route")

        result, out = run_marker(env=ENV, urlopen=boom)
        self.assertFalse(result)
        self.assertIn("WARNING", out)
        self.assertNotIn("tok-secret", out)

    def test_refuses_a_plain_http_base_url(self):
        urlopen = fake_urlopen()
        result, _ = run_marker(env={**ENV, "SENTRY_URL": "http://sentry.example"}, urlopen=urlopen)
        self.assertFalse(result)
        self.assertEqual(urlopen.calls, [])


if __name__ == "__main__":
    unittest.main()
