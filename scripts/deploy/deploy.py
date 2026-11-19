#!/usr/bin/env python3
# Copyright (c) 2026 Asir Khan. All rights reserved.
# All Rights Reserved. See the LICENSE file.
#
# Festie production deploy (P12 / P14 / P16).
#
# Sanitized, env-driven replacement for the old uncommitted %TEMP% script that
# carried plaintext SSH + login credentials. This script:
#
#   1. SSHes to the prod box (KEY AUTH ONLY — no password support).
#      Before anything changes it runs scripts/backup-pg.sh and aborts if the
#      dump fails (pre_deploy_dump).
#   2. git fetch + reset --hard to the deploy ref (default origin/main), after
#      taking a host-side lock and checking that the commit's CI is green, then
#      installs root (npm) and
#      packages/ (pnpm) dependencies.
#   3. Migrations are app-managed (applied on backend boot); no deploy step.
#   4. Bundles the backend with `npm run build` (esbuild -> dist/server.js, which
#      PM2 runs).
#   5. Builds the web bundle (fetches the private fonts first).
#   6. Restarts the PM2 app ("festie") by name. A restart does not pick up a
#      changed script or interpreter; that needs `pm2 delete` + `pm2 start`.
#   7. Health-gates on /api/ready; if it is non-200, ABORTS and prints the
#      rollback command (P16).
#   8. Smoke-tests a real login (200) if test creds are provided.
#   9. Tags the deploy `deploy-<UTC timestamp>` and pushes the tag (P14).
#
# Configuration (all via environment — nothing secret is committed):
#   FESTIE_SSH_HOST       prod host/IP                 (default 192.168.0.150)
#   FESTIE_SSH_USER       prod SSH user                (default asir)
#   FESTIE_SSH_KEY        path to a private key file   (optional; falls back to
#                                                        the agent / ~/.ssh keys)
#   FESTIE_SSH_KNOWN_HOSTS  extra known_hosts file     (optional; ~/.ssh/known_hosts is
#                                                        always loaded. An unknown or changed
#                                                        host key aborts — add it with ssh-keyscan
#                                                        after checking it out of band)
#   FESTIE_APP_DIR        app dir on the server        (default /home/asir/festival-planner)
#   FESTIE_PM2_NAME       PM2 process name             (default festie)
#   FESTIE_READY_URL      readiness URL on the server  (default http://localhost:4000/api/ready)
#   FESTIE_LOGIN_URL      login URL on the server      (default http://localhost:4000/api/v1/auth/login)
#   FESTIE_TEST_USER      smoke-login username         (optional — skips login check if unset)
#   FESTIE_TEST_PASSWORD  smoke-login password         (optional)
#   FESTIE_DEPLOY_REF     ref to deploy; pin the SHA you rehearsed on staging
#                                                       (default origin/main)
#   FESTIE_GH_REPO        GitHub repo for the CI check (default uhsear/festie)
#   FESTIE_SKIP_CI_CHECK  set to 1 to skip the CI-green check (optional)
#
# The deploy lock is a directory on the host (LOCK_DIR). A deploy killed before
# it finishes leaves the lock behind: check no deploy is running, then remove it.
#
# There is NO password-auth path by design. If key auth fails, fix the key —
# do not add a password.

import json
import os
import socket
import subprocess
import sys
import time

try:
    import paramiko
except ImportError:
    sys.exit("paramiko is required: pip install paramiko")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = os.environ.get("FESTIE_SSH_HOST", "192.168.0.150")
USER = os.environ.get("FESTIE_SSH_USER", "asir")
KEY = os.environ.get("FESTIE_SSH_KEY")  # optional explicit key file
KNOWN_HOSTS = os.environ.get("FESTIE_SSH_KNOWN_HOSTS")  # optional extra known_hosts file
APP = os.environ.get("FESTIE_APP_DIR", "/home/asir/festival-planner")
PM2_NAME = os.environ.get("FESTIE_PM2_NAME", "festie")
READY_URL = os.environ.get("FESTIE_READY_URL", "http://localhost:4000/api/ready")
LOGIN_URL = os.environ.get("FESTIE_LOGIN_URL", "http://localhost:4000/api/v1/auth/login")
TEST_USER = os.environ.get("FESTIE_TEST_USER")
TEST_PASSWORD = os.environ.get("FESTIE_TEST_PASSWORD")
DEPLOY_REF = os.environ.get("FESTIE_DEPLOY_REF", "origin/main")
GH_REPO = os.environ.get("FESTIE_GH_REPO", "uhsear/festie")
SKIP_CI_CHECK = os.environ.get("FESTIE_SKIP_CI_CHECK") == "1"
LOCK_DIR = "/tmp/festie-deploy.lock"  # mkdir is atomic; /tmp clears on reboot


def run(client, cmd, timeout=300):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def load_host_keys(client):
    """Verify the server against known_hosts; an unknown or changed key aborts."""
    client.load_system_host_keys()
    if KNOWN_HOSTS:
        client.load_host_keys(KNOWN_HOSTS)
    client.set_missing_host_key_policy(paramiko.RejectPolicy())


def connect():
    client = paramiko.SSHClient()
    load_host_keys(client)
    # Key auth ONLY. With key_filename set we point at the explicit key; without
    # it paramiko uses the SSH agent and the default ~/.ssh identities. We never
    # pass a password and disable interactive password fallback.
    connect_kwargs = dict(
        hostname=HOST,
        username=USER,
        timeout=20,
        allow_agent=True,
        look_for_keys=True,
    )
    if KEY:
        connect_kwargs["key_filename"] = KEY
    client.connect(**connect_kwargs)
    return client


def acquire_lock(client, runner=run):
    """Take the host-side deploy lock; a second concurrent deploy aborts."""
    code, out, err = runner(client, f"mkdir {LOCK_DIR}")
    if code != 0:
        raise SystemExit(
            f"deploy lock {LOCK_DIR} is held ({err.strip()}); another deploy may be running. "
            "If none is, remove the directory on the host and deploy again."
        )


def release_lock(client, runner=run):
    runner(client, f"rmdir {LOCK_DIR}")


def resolve_ref(client, runner=run):
    """Fetch, then return the full SHA of DEPLOY_REF. Does not touch the working tree."""
    code, out, err = runner(
        client, f"cd {APP} && git fetch origin --tags && git rev-parse --verify '{DEPLOY_REF}^{{commit}}'"
    )
    sha = out.strip().splitlines()[-1] if out.strip() else ""
    if code != 0 or not sha:
        raise SystemExit(f"cannot resolve {DEPLOY_REF} on the host: {err.strip()}; nothing was changed.")
    return sha


def ci_green(sha):
    """True when the commit has check runs and every one succeeded or was skipped."""
    result = subprocess.run(
        ["gh", "api", f"repos/{GH_REPO}/commits/{sha}/check-runs?per_page=100",
         "--jq", '[.total_count, ([.check_runs[] | select(.conclusion != "success" and .conclusion != "skipped")] | length)] | @tsv'],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise SystemExit(f"CI check failed to run ({result.stderr.strip()}); set FESTIE_SKIP_CI_CHECK=1 to skip it.")
    total, bad = (int(n) for n in result.stdout.split())
    return total > 0 and bad == 0


def pre_deploy_dump(client, runner=run):
    """Dump the database before the deploy changes anything.

    Fails closed: a non-zero exit raises SystemExit, so no later step runs and
    production stays untouched. Writes made while the build runs are not in the
    dump; that gap is accepted. It runs the host's current backup-pg.sh.
    """
    try:
        code, out, err = runner(client, f"cd {APP} && bash scripts/backup-pg.sh", timeout=600)
    except socket.timeout:
        raise SystemExit(
            "pre-deploy dump failed (timed out after 600s); nothing was changed on the host. "
            "Fix the dump, then deploy again."
        )
    print(f"[pre-deploy-dump] exit={code}\n{out}{err}")
    # backup-pg.sh only warns when pg_restore --list fails, and still exits 0.
    if code != 0 or "pg_restore --list failed" in f"{out}{err}":
        raise SystemExit(
            f"pre-deploy dump failed (exit {code}); nothing was changed on the host. "
            "Fix the dump, then deploy again."
        )


def wait_ready(client, runner=run, attempts=20, delay=3):
    """Poll /api/ready until it returns 200; boot applies migrations, so it can be slow."""
    ready_code = ""
    for attempt in range(attempts):
        code, out, err = runner(client, f"curl -s -o /dev/null -w '%{{http_code}}' {READY_URL}")
        ready_code = out.strip()
        if ready_code == "200":
            break
        if attempt < attempts - 1:
            time.sleep(delay)
    return ready_code


def smoke_login(client, runner=run):
    """Log in with the test credentials and return the HTTP status.

    One command, so one remote shell: $$ is the same in the write, the curl and
    the rm. The trap removes the password file even if curl fails.
    """
    payload = json.dumps({"username": TEST_USER, "password": TEST_PASSWORD})
    tmp = "/tmp/festie-login.$$.json"
    code, out, err = runner(
        client,
        f"umask 077 && trap 'rm -f {tmp}' EXIT && cat > {tmp} <<'EOF'\n{payload}\nEOF\n"
        f"curl -s -o /dev/null -w '%{{http_code}}' -X POST {LOGIN_URL} "
        "-H 'Content-Type: application/json' -H 'X-Festie-Request: 1' "
        f"-d @{tmp}",
        timeout=60,
    )
    return out.strip()


def rollback_hint(tag=None):
    target = tag or "deploy-<previous-timestamp>"
    print("")
    print("=" * 60)
    print("DEPLOY ABORTED — server may be in a bad state.")
    print("Roll back with the last known-good deploy tag:")
    print(f"  ssh {USER}@{HOST} 'cd {APP} && bash scripts/deploy/rollback.sh {target}'")
    print("(List tags:  git tag -l 'deploy-*' | sort)")
    print("=" * 60)


def main():
    deploy_tag = "deploy-" + time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    client = connect()
    locked = False
    try:
        acquire_lock(client)
        locked = True

        # Pin the commit before anything changes, so a merge landing mid-deploy
        # cannot ship, and refuse a commit whose CI is not green.
        sha = resolve_ref(client)
        print(f"[ref] {DEPLOY_REF} -> {sha}")
        if not SKIP_CI_CHECK and not ci_green(sha):
            raise SystemExit(f"CI is not green for {sha}; nothing was changed. Fix CI or set FESTIE_SKIP_CI_CHECK=1.")

        # 0. Dump the database while nothing has changed yet.
        pre_deploy_dump(client)

        # 1. Sync to the pinned commit
        code, out, err = run(
            client,
            f"cd {APP} && git reset --hard {sha} && git log --oneline -1",
        )
        print(f"[git] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("git sync failed")

        # 2. Install deps. The bundle is built with --packages=external, so every
        # RUNTIME dependency (e.g. bullmq) must still be present in the root
        # node_modules or the app crash-loops on boot with ERR_MODULE_NOT_FOUND.
        # esbuild itself lives in `dependencies`, not devDependencies, so it
        # survives the --omit=dev below and step 4 can run.
        # The root is an npm project; packages/ is a pnpm workspace. Install both
        # so a deploy that adds a backend or frontend dep doesn't take prod down.
        # (login shell so npm/pnpm are on PATH).
        code, out, err = run(
            client,
            f"bash -lc 'set -o pipefail; cd {APP} && npm ci --omit=dev --no-audit --no-fund "
            f"&& cd {APP}/packages && pnpm install --frozen-lockfile 2>&1 | tail -10'",
            timeout=600,
        )
        print(f"[deps] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("dependency install failed")

        # 3. Migrations are APP-MANAGED: lib/planner-db-pg.ts owns a version-keyed
        # `schema_migrations` ledger and applies any pending migrations/*.sql once
        # per Postgres URL on backend boot (the pm2 restart below triggers it). There
        # is no separate migration step in the deploy — adding one would double-run
        # and conflict with that ledger.

        # 4. Bundle the backend to dist/. PM2 execs dist/server.js (see
        # ecosystem.config.cjs) and dist/ is gitignored, so this step is the ONLY
        # thing that creates the artifact on the host.
        #
        # Placed here — after the dependency install, before the web build and
        # well before the pm2 restart — on purpose. Nothing user-visible has
        # changed yet at this point: the served web bundle is still the old one
        # and the running backend is still the old process, so aborting here
        # leaves prod entirely on the previous release instead of half-updated
        # (new SPA assets in front of an old backend). It is also the cheapest
        # step that can fail: seconds, against minutes for the web build.
        code, out, err = run(
            client,
            f"bash -lc 'set -o pipefail; cd {APP} && npm run build 2>&1 | tail -5'",
            timeout=600,
        )
        print(f"[bundle] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("backend bundle build failed")

        # 5. Build the web bundle (login shell so pnpm is on PATH). The licensed
        # fonts are gitignored (private repo uhsear/festie-fonts); fetch them as a
        # required step first, so a missing font aborts here, before the restart.
        code, out, err = run(
            client,
            f"bash -lc 'set -o pipefail; cd {APP} && node scripts/fetch-fonts.mjs && "
            f"cd {APP}/packages && pnpm --filter @festie/web build 2>&1 | tail -8'",
            timeout=600,
        )
        print(f"[build] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("web build failed")

        # NOTE: festie.us serves the Vite SPA (packages/web). The Expo
        # react-native-web export (`pnpm run build:web` in packages/mobile) is no
        # longer built here — it is kept dormant for a possible future
        # app.festie.us, but the desktop flagship is the bespoke web SPA.

        # 6. Restart the backend
        code, out, err = run(
            client,
            # By NAME on purpose. `pm2 restart <config file>` re-reads the ENV only —
            # it does NOT pick up a changed `script` or `interpreter`, so it cannot
            # apply a runtime change. Only `pm2 delete` + `pm2 start <config>` does
            # that, and that is a deliberate step for the cutover, not something a
            # routine deploy should do.
            f"pm2 restart {PM2_NAME} && pm2 ls | grep {PM2_NAME}",
        )
        print(f"[pm2] exit={code}\n{out}{err}")
        if code != 0:
            rollback_hint()
            raise SystemExit("pm2 restart failed; the old process may still be serving")

        # 7. Readiness gate (db + redis) — abort + rollback hint on non-200 (P16)
        ready_code = wait_ready(client)
        print(f"[ready] http={ready_code}")
        if ready_code != "200":
            rollback_hint()
            raise SystemExit(f"/api/ready returned {ready_code} — deploy is NOT healthy")

        # 8. Real login smoke test (only if creds provided). Write the payload to
        # a temp file on the server and curl it with -d @file so the password
        # never appears in the server process list or shell history.
        if TEST_USER and TEST_PASSWORD:
            login_code = smoke_login(client)
            print(f"[login] http={login_code}")
            if login_code != "200":
                rollback_hint()
                raise SystemExit(f"login smoke test returned {login_code}")
        else:
            print("[login] skipped (FESTIE_TEST_USER / FESTIE_TEST_PASSWORD not set)")

        # 9. Tag the deploy and push the tag (P14)
        code, out, err = run(
            client,
            f"cd {APP} && git tag {deploy_tag} && git push origin {deploy_tag}",
        )
        print(f"[tag] exit={code} tag={deploy_tag}\n{out}{err}")
        if code != 0:
            print("WARNING: deploy succeeded but tag push failed — tag manually for rollback safety.")

        print(f"\nDeploy OK — tagged {deploy_tag}")
    finally:
        if locked:
            release_lock(client)
        client.close()


if __name__ == "__main__":
    main()
