# Copyright (c) 2026 Asir Khan. All rights reserved.
# All Rights Reserved. See the LICENSE file.
#
# Post-deploy smoke checks used by scripts/deploy/verify.py. Standard library
# only, read-only against the app, and nothing here prints a secret.
#
#   web      GET / is 200 HTML that references a JS entry, and that asset is 200
#   socket   the Socket.IO websocket upgrade answers 101. The server allows the
#            websocket transport only (lib/socket-setup.ts), so an engine.io
#            polling handshake is rejected with 400 by design.
#   login    only when FESTIE_SMOKE_USER and FESTIE_SMOKE_PASSWORD are set:
#            login 200 + session cookie, GET /auth/me 200, then log out
#
# Requests go through a `fetch` callable, so the checks run unchanged from the
# operator machine or, via make_remote_fetch, as curl on the app host (where
# localhost:4000 is reachable).

import json
import re
import shlex

# The built entry is the module script under assets/. index.html also carries classic scripts
# (font-loader.js, theme-init.js, boot-guard.js): static files that prove nothing about the build.
SCRIPT_TAG = re.compile(r"<script\b[^>]*>", re.IGNORECASE)
MODULE_TYPE = re.compile(r"""\btype=["']module["']""", re.IGNORECASE)
ENTRY_SRC = re.compile(r"""\bsrc=["']([^"']*\bassets/[^"']+\.js)["']""", re.IGNORECASE)
WS_HEADERS = (
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: ZmVzdGllLXNtb2tlLTAwMQ==",
)
JSON_HEADERS = ("Content-Type: application/json", "X-Festie-Request: 1")


def parse_response(raw):
    """Split `curl -i` output into (status, [(name, value)], body). Status 0 means no response."""
    text = raw.replace("\r\n", "\n")
    while True:
        head, _, rest = text.partition("\n\n")
        lines = head.split("\n")
        if not lines[0].startswith("HTTP/"):
            return 0, [], ""
        parts = lines[0].split(None, 2)
        status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        if status == 100:  # interim "100 Continue": the real response follows
            text = rest
            continue
        headers = [
            (name.strip().lower(), value.strip())
            for name, _, value in (h.partition(":") for h in lines[1:])
            if value
        ]
        return status, headers, rest


def _config_quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def make_remote_fetch(runner):
    """Build a fetch() that runs curl on the app host. runner(cmd, timeout) -> (code, out, err).

    Headers and body travel as a curl config on stdin, so a cookie or password
    never appears in the host's process list.
    """

    def fetch(method, url, headers=(), data=None, max_time=30):
        lines = [f"header = {_config_quote(h)}" for h in headers]
        if data is not None:
            lines.append(f"data-raw = {_config_quote(data)}")
        config = "\n".join(lines)
        cmd = (
            f"curl -s -i -m {int(max_time)} -X {method} -K - {shlex.quote(url)} <<'FESTIE_SMOKE_EOF'\n"
            f"{config}\nFESTIE_SMOKE_EOF"
        )
        # curl exits 28 when -m cuts the websocket off after the 101; the headers are already out.
        _code, out, _err = runner(cmd, max_time + 30)
        return parse_response(out)

    return fetch


def check_web(fetch, base):
    status, headers, body = fetch("GET", f"{base}/")
    content_type = next((v for k, v in headers if k == "content-type"), "")
    if status != 200 or "text/html" not in content_type:
        return [f"GET / returned {status} ({content_type or 'no content-type'}), expected 200 text/html"]
    src = next(
        (m.group(1) for tag in SCRIPT_TAG.findall(body) if MODULE_TYPE.search(tag) and (m := ENTRY_SRC.search(tag))),
        None,
    )
    if not src:
        return ['GET / HTML has no <script type="module" src=".../assets/....js"> entry; the web build is missing or broken']
    url = src if re.match(r"https?://", src) else base + (src if src.startswith("/") else "/" + src)
    asset_status = fetch("GET", url)[0]
    print(f"[smoke:web] / 200 html, entry {src} http={asset_status}")
    return [] if asset_status == 200 else [f"JS entry {src} returned {asset_status}"]


def check_socket(fetch, base):
    status = fetch("GET", f"{base}/socket.io/?EIO=4&transport=websocket", WS_HEADERS, None, 3)[0]
    print(f"[smoke:socket] websocket upgrade http={status}")
    return [] if status == 101 else [f"Socket.IO websocket upgrade returned {status}, expected 101"]


def check_login(fetch, login_url, user, password):
    me_url = login_url.rsplit("/", 1)[0] + "/me"
    logout_url = login_url.rsplit("/", 1)[0] + "/logout"
    payload = json.dumps({"username": user, "password": password})
    status, headers, _ = fetch("POST", login_url, JSON_HEADERS, payload)
    cookie = "; ".join(
        v.split(";", 1)[0] for k, v in headers if k == "set-cookie" and "=" in v.split(";", 1)[0]
        and v.split(";", 1)[0].split("=", 1)[1]
    )
    print(f"[smoke:login] login http={status} session_cookie={'yes' if cookie else 'no'}")
    if status != 200:
        return [f"smoke login returned {status}"]
    if not cookie:
        return ["smoke login returned 200 without a session cookie"]
    failures = []
    auth = (f"Cookie: {cookie}",)
    me_status = fetch("GET", me_url, auth)[0]
    print(f"[smoke:login] /auth/me http={me_status}")
    if me_status != 200:
        failures.append(f"/auth/me returned {me_status} with the smoke session")
    out_status = fetch("POST", logout_url, JSON_HEADERS + auth, "{}")[0]
    print(f"[smoke:login] logout http={out_status}")
    if out_status != 200:
        failures.append(f"logout returned {out_status}")
    return failures


def run_smoke(fetch, base, login_url, user=None, password=None):
    """Run every smoke check and return the list of failure messages."""
    failures = check_web(fetch, base) + check_socket(fetch, base)
    if user and password:
        failures += check_login(fetch, login_url, user, password)
    else:
        print("[smoke:login] skipped (FESTIE_SMOKE_USER / FESTIE_SMOKE_PASSWORD not set)")
    return failures
