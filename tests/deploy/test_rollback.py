"""Characterization tests for scripts/deploy/rollback.sh.

The script runs under bash in a temp directory whose PATH starts with stub
git, npm, pnpm, pm2, curl and sleep programs that log their arguments. Nothing
reaches a real host, repository or process manager.

Run: python -m unittest discover -s tests/deploy -p "test_*.py"
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROLLBACK = Path(__file__).resolve().parents[2] / "scripts" / "deploy" / "rollback.sh"
BASH = shutil.which("bash")

STUB = """#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
case "$(basename "$0") $1" in
  "git rev-parse") exit "${TAG_RC:-0}" ;;
  "git tag") echo deploy-20260101-000000 ;;
  "curl -s") printf '%s' "${READY_CODE:-200}" ;;
esac
exit 0
"""


@unittest.skipUnless(BASH, "bash not available")
class RollbackTest(unittest.TestCase):
    def run_rollback(self, *args, **env):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        bin_dir = Path(tmp.name) / "bin"
        bin_dir.mkdir()
        (Path(tmp.name) / "packages").mkdir()
        for name in ("git", "npm", "pnpm", "pm2", "curl", "sleep"):
            (bin_dir / name).write_text(STUB, newline="\n")
            (bin_dir / name).chmod(0o755)  # without it the real git/npm/pm2 on PATH run
        log = Path(tmp.name) / "calls.log"
        log.write_text("")
        proc = subprocess.run(
            [BASH, str(ROLLBACK), *args],
            cwd=tmp.name,
            env={**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
                 "STUB_LOG": str(log), **env},
            capture_output=True, text=True, timeout=60,
        )
        return proc, log.read_text().splitlines()

    def test_no_tag_prints_usage_and_exits_2(self):
        proc, calls = self.run_rollback()
        self.assertEqual(proc.returncode, 2)
        self.assertIn("usage:", proc.stderr)
        self.assertFalse(any(c.startswith(("npm", "pm2")) for c in calls))

    def test_unknown_tag_exits_2_without_reset_or_build(self):
        proc, calls = self.run_rollback("deploy-x", TAG_RC="1")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("not found", proc.stderr)
        self.assertFalse(any(c.startswith(("git reset", "npm", "pm2")) for c in calls))

    def test_happy_path_builds_before_touching_pm2(self):
        proc, calls = self.run_rollback("deploy-x")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        order = ["git reset --hard deploy-x", "npm ci --omit=dev --no-audit --no-fund",
                 "pnpm install --frozen-lockfile", "npm run build", "pnpm --filter @festie/web build",
                 "pm2 delete festie", "pm2 start ecosystem.config.cjs --only festie"]
        positions = [next(i for i, c in enumerate(calls) if c == m) for m in order]
        self.assertEqual(positions, sorted(positions))

    def test_not_ready_exits_1(self):
        proc, _ = self.run_rollback("deploy-x", READY_CODE="503")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("503", proc.stderr)

    def test_pm2_name_override(self):
        _, calls = self.run_rollback("deploy-x", FESTIE_PM2_NAME="festie-staging")
        self.assertIn("pm2 delete festie-staging", calls)

    def test_body_runs_inside_main_function(self):
        # The script resets its own working tree; a top-level body would be
        # re-read by byte offset after the reset. Keep everything in main().
        text = ROLLBACK.read_text()
        self.assertIn("\nmain() {", text)
        self.assertTrue(text.rstrip().endswith('main "$@"'))


if __name__ == "__main__":
    unittest.main()
