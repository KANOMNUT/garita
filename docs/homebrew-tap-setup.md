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

The cask also has a `binary` stanza (`#{appdir}/Garita.app/Contents/MacOS/garita`), so Homebrew links a `garita` command into its own prefix (`/opt/homebrew/bin` on Apple Silicon); Settings → Command line reads that link as installed. The stanza has no `target:` because the binary is already named `garita`, and it needs no change on a version bump.

The cask sets `auto_updates true`: the app updates itself (Settings → Updates). A bare `brew upgrade` still upgrades it when the installed app is older than the cask, and `brew upgrade --cask garita` names it explicitly. The cask `version` and `sha256` are bumped by hand, as described below.

## Bump after a release (by hand)

No workflow updates the cask. After the draft release is **published**:

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

Check after every release that the bump landed: compare the cask `version` with the
newest tag.

```bash
brew info --cask kanomnut/garita/garita
brew audit --cask --online kanomnut/garita/garita
```
