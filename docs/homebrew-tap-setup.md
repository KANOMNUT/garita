# Garita — Homebrew Cask Tap

The Homebrew Cask lives in **this repo** at `Casks/garita.rb`. Homebrew can tap any Git
URL, so the repo doubles as the tap and no separate tap repo is needed. The cask installs
the macOS ARM64 `.dmg` from the GitHub release.

> Garita is ad-hoc signed, not notarized, so Gatekeeper blocks a downloaded copy on first
> launch. The cask's `postflight` clears the quarantine flag (`xattr -rd`). The published DMG
> is Apple Silicon only.

## Install

```bash
brew tap KANOMNUT/garita https://github.com/KANOMNUT/garita
brew install --cask kanomnut/garita/garita
brew upgrade --cask garita        # later releases
```

Since Homebrew 6.0.0, a non-official tap needs explicit trust. Installing the fully qualified name (`kanomnut/garita/garita`) trusts that one cask, so the lines above work as they are. A first install by the short name (`brew install --cask garita`) needs `brew trust --cask kanomnut/garita/garita` first.

**Standard (non-admin) account.** `/Applications` is writable only by administrators. Install into your home folder instead: `--appdir` is a cask option (default `/Applications`), and `HOMEBREW_CASK_OPTS` appends it to every cask command ([Homebrew manpage](https://docs.brew.sh/Manpage)):

```bash
mkdir -p ~/Applications
echo 'export HOMEBREW_CASK_OPTS="--appdir=$HOME/Applications"' >> ~/.zshenv
export HOMEBREW_CASK_OPTS="--appdir=$HOME/Applications"
brew install --cask kanomnut/garita/garita
```

The cask needs no change for this: `app`, `binary` and `postflight` all go through `#{appdir}`. Homebrew itself needs a prefix the account can write; on a standard account an administrator provisions it once ([Homebrew: Installation](https://docs.brew.sh/Installation)). In `~/Applications` the in-app updater replaces the app without a password; in `/Applications` on a standard account it asks for an administrator's.

The cask also has a `binary` stanza (`#{appdir}/Garita.app/Contents/MacOS/garita`), so Homebrew links a `garita` command into its own prefix (`/opt/homebrew/bin` on Apple Silicon); Settings → Command line reads that link as installed. The stanza has no `target:` because the binary is already named `garita`, and it needs no change on a version bump.

The cask sets `auto_updates true`: the app updates itself (Settings → Updates). A bare `brew upgrade` still upgrades it when the installed app is older than the cask, and `brew upgrade --cask garita` names it explicitly. The cask `version` and `sha256` are bumped through a pull request after each release, as described below.

## Bump after a release

`.github/workflows/homebrew.yml` opens the bump as a pull request. It runs when a release is published (`release: released`: a pre-release never runs it, one changed to a release does) and:

1. checks that the tag is `vX.Y.Z` and that the release is neither a draft nor a pre-release;
2. downloads `Garita-macOS-arm64.dmg` and `SHA256SUMS.txt` from the release, computes the DMG's sha256 and fails unless it equals the DMG's line in `SHA256SUMS.txt` (a missing file fails too);
3. stops without a change when the cask on `main` already has that version and sha256, and stops with a warning when the cask's version is newer than the release (a release for an older line never downgrades the cask);
4. commits the new `version` and `sha256` to the branch `bot/cask-vX.Y.Z`, created from `main`, and opens a pull request into `main` titled `chore: update cask to vX.Y.Z`.

It uses no checkout and no actions, only `gh` on the runner, and its job alone gets `contents: write` and `pull-requests: write`. Re-running it is safe: a bump branch that already has the change and an open pull request from it are reused, and the branch is never reset or force-pushed.

Review the pull request and merge it. To test the cask on a Mac first, check the branch out (`git fetch origin && git switch bot/cask-vX.Y.Z`) and run the `brew tap` to `brew untap` lines of step 3 under By hand (fallback).

What `GITHUB_TOKEN`, which opens the pull request, cannot do:

- **No workflow runs on the bump pull request.** GitHub starts no workflow for events that `GITHUB_TOKEN` causes, so CI, PR title and Labeler do not run on it. That is fine while `main` requires no status check. Once `CI OK` is required, close and reopen the pull request (or push a commit to its branch) so that CI runs, or give the workflow a GitHub App token instead.
- **It needs a repository setting.** Settings > Actions > General > "Allow GitHub Actions to create and approve pull requests" must be on. Without it the run fails when it opens the pull request. The branch already holds the bump commit at that point, so open the pull request from it by hand, or turn the setting on and re-run.
- **A release event runs the workflow file as it is at the release's tag.** Releases tagged before `homebrew.yml` reached `main` are not bumped on their own. For one of those, or to retry a failed run: `gh workflow run homebrew.yml -R KANOMNUT/garita -f tag=vX.Y.Z`.

### By hand (fallback)

When the workflow cannot run, after the draft release is **published**:

1. Take the sha256 of `Garita-macOS-arm64.dmg` from `SHA256SUMS.txt` on the release, or compute it:

   ```bash
   curl -L "https://github.com/KANOMNUT/garita/releases/download/vX.Y.Z/Garita-macOS-arm64.dmg" -o /tmp/garita.dmg
   shasum -a 256 /tmp/garita.dmg
   ```

2. Edit `Casks/garita.rb`: set both `version` and `sha256`.
3. On a Mac, check the cask from a local clone before it reaches `main`. Commit the change on a branch first: the test tap clones the clone's checked-out branch.

   ```bash
   brew style --fix Casks/garita.rb    # Homebrew 7 also rewrites `postflight` as `postflight_steps`
   git switch -c cask-vX.Y.Z && git commit -am "chore: update cask to vX.Y.Z"
   brew tap kanomnut/garita-test "$PWD"
   brew trust --cask kanomnut/garita-test/garita
   brew audit --cask --online kanomnut/garita-test/garita
   brew install --cask kanomnut/garita-test/garita && garita --version   # opens without a Gatekeeper block
   brew uninstall --cask garita && brew untap kanomnut/garita-test
   ```

   Without a Mac, bump only `version` and `sha256`. The legacy `postflight` block still works; Homebrew 7 prints a deprecation warning for it until 2027-12-11.

4. Push the branch and merge it to `main` through a pull request (the `main` ruleset requires one).

Check after every release that the bump landed (the bump pull request is merged): compare
the cask `version` on `main` with the newest tag.

```bash
brew info --cask kanomnut/garita/garita
brew audit --cask --online kanomnut/garita/garita
```
