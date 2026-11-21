# iOS testing without a Mac

Two GitHub Actions workflows test the iOS app on free GitHub-hosted macOS runners.

| Workflow | Use it to |
|----------|-----------|
| `ios-e2e.yml` | Build the simulator app and run the Maestro flows. |
| `ios-sim-session.yml` | Drive the app by hand in a simulator in your browser. |

## Cost and limits

- Standard GitHub-hosted runners are free on a public repository. Never switch a job to a larger runner label, because larger runners cost money.
- Each run builds the app from scratch. Expect 20 to 25 minutes for the build, plus the session length.
- Simulators have no push notifications.
- Live Activities work in simulators on iOS 16.1 and later.
- Sign in with Apple needs an Apple ID signed in to the simulator. Sign in through the simulator's Settings app first.
- Only one session runs at a time. A second request waits for the first.

## Run the build and the Maestro flows

1. Merge the workflow changes to `main`. GitHub lists dispatchable workflows from the default branch.
2. Run `gh workflow run ios-e2e.yml --ref <branch>`.
3. To build another ref, add `-f ref=<branch, tag or sha>`.
4. To build without testing, add `-f run_maestro=false`.
5. Open the run in the Actions tab. It runs `ios-smoke.yaml` and `ios-artist-sheet.yaml` from `packages/mobile/.maestro/`.

The workflow also runs every Sunday on `main`.

Every run uploads the zipped simulator app as the artifact `ios-simulator-app-<short sha>`. The artifact expires after 7 days.

## Set the session password

The session workflow refuses to start without a password. This stops a public pull request from opening an unauthenticated simulator.

1. Choose a long random password.
2. Run `gh secret set IOS_SIM_SESSION_PASSWORD`.
3. Paste the password when `gh` asks for it.

The same password opens every session link.

## Open a session

Dispatch from the command line:

1. Run `gh workflow run ios-sim-session.yml --ref <branch>`.
2. To pick the build, device or length, add `-f ref=<git ref>`, `-f device="iPhone 17 Pro"` or `-f minutes=45`. The length is 5 to 60 minutes and defaults to 30.
3. If the branch has no open pull request, add `-f pr_number=<number>`. The workflow posts the link on that pull request.

Or comment `/ios-sim` on a pull request. Only the repository owner can do this, and the pull request must come from this repository. The comment builds the pull request head with the default device and length.

Then:

1. Wait for the build job, then for the session job to post a comment with an "Open SimDeck" link.
2. Open the link and enter the session password.
3. Use Festie in the simulator. The session ends when the time is up. To end it sooner, cancel the run.

The link goes through the SimDeck proxy at `ci.simdeck.sh`, which holds only the tunnel address and the password-encrypted access token.

## Pinned versions

The session action is pinned to the commit of SimDeck release `simdeck-v0.2.1`, and the `simdeck` npm package is pinned to `0.2.1`. To upgrade, read the new release notes, then change both pins in `ios-sim-session.yml`.

The action downloads the latest `cloudflared` without a checksum. This workflow cannot pin it.
