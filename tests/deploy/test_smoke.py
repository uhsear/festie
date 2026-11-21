"""Unit tests for scripts/deploy/smoke.py. Standard library only; no network."""

import importlib.util
import io
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SMOKE_PY = Path(__file__).resolve().parents[2] / "scripts" / "deploy" / "smoke.py"
spec = importlib.util.spec_from_file_location("festie_smoke_under_test", SMOKE_PY)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

BASE = "http://localhost:4000"
LOGIN = BASE + "/api/v1/auth/login"
INDEX = '<html><script type="module" crossorigin src="/assets/index-abc123.js"></script></html>'
HTML = [("content-type", "text/html; charset=utf-8")]


def fake_fetch(routes):
    """routes: {(method, path-or-url): (status, headers, body)}; records every call."""
    calls = []

    def fetch(method, url, headers=(), data=None, max_time=30):
        calls.append((method, url, tuple(headers), data))
        key = (method, url[len(BASE):] if url.startswith(BASE) else url)
        return routes.get(key, (404, [], ""))

    fetch.calls = calls
    return fetch


GOOD = {
    ("GET", "/"): (200, HTML, INDEX),
    ("GET", "/assets/index-abc123.js"): (200, [], "x"),
    ("GET", "/socket.io/?EIO=4&transport=websocket"): (101, [], ""),
}


class ParseResponseTest(unittest.TestCase):
    def test_skips_100_continue_and_lowercases_headers(self):
        raw = "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nSet-Cookie: s=1; Path=/\r\nContent-Type: text/html\r\n\r\nbody"
        status, headers, body = smoke.parse_response(raw)
        self.assertEqual((status, body), (200, "body"))
        self.assertIn(("set-cookie", "s=1; Path=/"), headers)

    def test_empty_output_is_status_zero(self):
        self.assertEqual(smoke.parse_response("")[0], 0)


class WebAndSocketTest(unittest.TestCase):
    def run_checks(self, routes):
        with redirect_stdout(io.StringIO()):
            return smoke.run_smoke(fake_fetch(routes), BASE, LOGIN)

    def test_all_pass_and_login_skipped(self):
        self.assertEqual(self.run_checks(GOOD), [])

    def test_missing_script_entry_fails(self):
        routes = {**GOOD, ("GET", "/"): (200, HTML, "<html></html>")}
        self.assertEqual(len(self.run_checks(routes)), 1)

    def test_asset_404_fails(self):
        routes = {**GOOD, ("GET", "/assets/index-abc123.js"): (404, [], "")}
        self.assertIn("index-abc123.js returned 404", self.run_checks(routes)[0])

    def test_non_html_index_fails(self):
        routes = {**GOOD, ("GET", "/"): (200, [("content-type", "application/json")], INDEX)}
        self.assertIn("text/html", self.run_checks(routes)[0])

    def test_polling_only_server_fails_socket_check(self):
        routes = {**GOOD, ("GET", "/socket.io/?EIO=4&transport=websocket"): (400, [], "")}
        self.assertIn("101", self.run_checks(routes)[0])


class LoginTest(unittest.TestCase):
    def run_login(self, routes):
        fetch = fake_fetch({**GOOD, **routes})
        out = io.StringIO()
        with redirect_stdout(out):
            failures = smoke.run_smoke(fetch, BASE, LOGIN, "smoke-user", "s3cret-pass")
        return failures, fetch, out.getvalue()

    def test_login_me_logout_pass_without_printing_secrets(self):
        cookie = [("set-cookie", "festie_session=tok123; Path=/; HttpOnly")]
        failures, fetch, out = self.run_login({
            ("POST", "/api/v1/auth/login"): (200, cookie, "{}"),
            ("GET", "/api/v1/auth/me"): (200, [], "{}"),
            ("POST", "/api/v1/auth/logout"): (200, [], "{}"),
        })
        self.assertEqual(failures, [])
        me = [c for c in fetch.calls if c[1].endswith("/auth/me")][0]
        self.assertIn("Cookie: festie_session=tok123", me[2])
        self.assertNotIn("s3cret-pass", out)
        self.assertNotIn("tok123", out)

    def test_login_without_cookie_fails_and_stops(self):
        failures, fetch, _ = self.run_login({("POST", "/api/v1/auth/login"): (200, [], "{}")})
        self.assertEqual(failures, ["smoke login returned 200 without a session cookie"])
        self.assertFalse([c for c in fetch.calls if c[1].endswith("/auth/me")])

    def test_bad_login_status_fails(self):
        failures, _, _ = self.run_login({("POST", "/api/v1/auth/login"): (401, [], "")})
        self.assertEqual(failures, ["smoke login returned 401"])

    def test_me_failure_still_logs_out(self):
        cookie = [("set-cookie", "festie_session=tok123; Path=/")]
        failures, fetch, _ = self.run_login({
            ("POST", "/api/v1/auth/login"): (200, cookie, "{}"),
            ("GET", "/api/v1/auth/me"): (401, [], ""),
            ("POST", "/api/v1/auth/logout"): (200, [], "{}"),
        })
        self.assertEqual(len(failures), 1)
        self.assertTrue([c for c in fetch.calls if c[1].endswith("/auth/logout")])


class RemoteFetchTest(unittest.TestCase):
    def test_secrets_go_on_stdin_not_argv_and_output_is_parsed(self):
        runner = mock.Mock(return_value=(0, "HTTP/1.1 200 OK\r\nX-A: b\r\n\r\nhi", ""))
        status, headers, body = smoke.make_remote_fetch(runner)(
            "POST", LOGIN, ("Cookie: a=b",), '{"password": "p\\"w"}'
        )
        self.assertEqual((status, body), (200, "hi"))
        cmd = runner.call_args.args[0]
        first_line, _, config = cmd.partition("\n")
        self.assertNotIn("Cookie", first_line)
        self.assertNotIn("password", first_line)
        self.assertIn('header = "Cookie: a=b"', config)
        self.assertIn('data-raw = "{\\"password\\": \\"p\\\\\\"w\\"}"', config)


if __name__ == "__main__":
    unittest.main()
