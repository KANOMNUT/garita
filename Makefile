.DEFAULT_GOAL := help

# ─── Shell ────────────────────────────────────────────────────────────────────
#
# Every recipe in this file is bash. On macOS/Linux SHELL is /bin/bash, as it always was.
#
# Windows: a native GNU make (MAKE_HOST "Windows32" / *-mingw32: the Chocolatey, scoop and
# winget builds) cannot resolve /bin/bash. Started from Git Bash it happens to find Git's
# sh.exe on PATH; started from PowerShell or cmd it silently falls back to cmd.exe and every
# recipe dies ("CreateProcess(NULL, uname -s, ...) failed", "'grep' is not recognized").
# So for that make, SHELL is pinned to Git for Windows' real bash (<Git>/usr/bin/bash.exe)
# and that dir goes FIRST on PATH, for $(shell uname -s) and the recipe tools (grep, sed,
# cygpath, rm). That is the same order Git Bash itself uses, so make behaves identically
# from PowerShell, cmd and Git Bash, and nobody has to edit PATH.
#   - Never a bare `bash`: on PATH that is usually C:\Windows\System32\bash.exe, the WSL
#     launcher, not Git Bash.
#   - Lookup: GIT_BASH=<Git>/usr/bin/bash.exe if given (an error if it is wrong), else Git
#     under %ProgramW6432%, %ProgramFiles%, %LOCALAPPDATA%\Programs (per-user install), else
#     the Git that `git` on PATH belongs to (`git --exec-path`, e.g. scoop). Fixed paths go
#     first: they need no subprocess, and a Git installed without `git` on PATH still
#     resolves without a CreateProcess error.
#   - A space in the path ("Program Files") is fine: verified with GNU make 4.4.1 from
#     PowerShell, cmd and Git Bash.
#   - Caveat (reasoned, not observed): that dir also holds link.exe, find.exe, sort.exe and
#     timeout.exe. In a VS Developer prompt (VCINSTALLDIR set), rustc's linker lookup goes
#     through PATH and can pick up Git's link.exe, the same as inside Git Bash. Run make from
#     a plain PowerShell, cmd or Git Bash instead.
# Cygwin/MSYS2 builds of make resolve /bin/bash themselves and take the else branch.

ifeq ($(OS),Windows_NT)
ifeq ($(filter %cygwin %msys,$(MAKE_HOST)),)
_NATIVE_WIN_MAKE := 1
endif
endif

ifdef _NATIVE_WIN_MAKE

_sp := $(subst ,, )
# $(1) if that path exists, else empty. $(wildcard) splits on unescaped spaces.
_exists = $(if $(wildcard $(subst $(_sp),\$(_sp),$(1))),$(1))
# <root>/usr/bin if <root> is a Git for Windows install, else empty.
_git_usr_bin = $(if $(call _exists,$(subst \,/,$(1))/usr/bin/bash.exe),$(subst \,/,$(1))/usr/bin)
# git --exec-path is <root>/<mingw64|clangarm64|...>/libexec/git-core.
_git_usr_bin_from_exec = $(if $(1),$(call _git_usr_bin,$(1)/../../..))

ifdef GIT_BASH
_GIT_USR_BIN := $(patsubst %/bash.exe,%,$(subst \,/,$(GIT_BASH)))
ifeq ($(and $(call _exists,$(_GIT_USR_BIN)/bash.exe),$(call _exists,$(_GIT_USR_BIN)/uname.exe)),)
$(error GIT_BASH="$(GIT_BASH)" is not Git for Windows' usr/bin/bash.exe (need bash.exe with uname.exe beside it). Example: GIT_BASH="C:/Program Files/Git/usr/bin/bash.exe")
endif
else
_GIT_USR_BIN := $(or \
  $(if $(ProgramW6432),$(call _git_usr_bin,$(ProgramW6432)/Git)),\
  $(if $(or $(ProgramFiles),$(PROGRAMFILES)),$(call _git_usr_bin,$(or $(ProgramFiles),$(PROGRAMFILES))/Git)),\
  $(if $(LOCALAPPDATA),$(call _git_usr_bin,$(LOCALAPPDATA)/Programs/Git)),\
  $(call _git_usr_bin_from_exec,$(shell git --exec-path)))
endif

define _NO_GIT_BASH
Git for Windows' bash not found.
  The recipes in this Makefile are bash. On Windows they run under Git for Windows'
  <Git>/usr/bin/bash.exe, which makes `make` work from PowerShell, cmd and Git Bash.
  Looked for: <Git> under %ProgramW6432%, %ProgramFiles%, %LOCALAPPDATA%\Programs,
  and the Git that `git --exec-path` reports.
  Fix: install Git for Windows (winget install --id Git.Git -e, or choco install git),
  or point at an existing one:  make <target> GIT_BASH="D:/Tools/Git/usr/bin/bash.exe"
endef

ifeq ($(_GIT_USR_BIN),)
$(error $(_NO_GIT_BASH))
endif

export PATH := $(_GIT_USR_BIN);$(PATH)
SHELL := $(_GIT_USR_BIN)/bash.exe
# make keeps the old SHELL, silently, when it cannot find the new one.
ifneq ($(SHELL),$(_GIT_USR_BIN)/bash.exe)
$(error make did not accept SHELL="$(_GIT_USR_BIN)/bash.exe" (it is still "$(SHELL)"). Pass GIT_BASH=<Git>/usr/bin/bash.exe)
endif

else

SHELL := /bin/bash

endif

UNAME  := $(shell uname -s)
VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")

# ─── Rust toolchain ───────────────────────────────────────────────────────────
#
# Windows only. Tauri needs the MSVC toolchain on Windows; the GNU one cannot link the
# app. Every cargo-invoking target is wrapped in $(call RUN,<cmd>), which on Windows:
#   1. makes rustup reachable ($CARGO_HOME/bin is not always on PATH),
#   2. fails fast, with the fix, if $(WIN_TOOLCHAIN) is not installed,
#   3. puts that toolchain's REAL bin dir FIRST on PATH and exports RUSTUP_TOOLCHAIN,
#   4. asserts that `cargo` and `rustc` now resolve to an MSVC host.
# On every other OS RUN is the identity, so the command runs exactly as written.
#
# Why not `rustup run <toolchain> cargo ...`: observed with rustup 1.29 on Windows, it puts
# the toolchain bin dir LAST on PATH, so a Chocolatey/scoop GNU `rustc` earlier on PATH
# still wins when cargo (or cargo-tauri's nested `cargo run`) looks `rustc` up. A GNU rustc reusing
# MSVC artifacts in src-tauri/target gives mass "E0461 couldn't find crate ... expected
# target triple x86_64-pc-windows-gnu". Prepending is the only order that is safe.
#
# Override the toolchain with `make dev WIN_TOOLCHAIN=<name>-x86_64-pc-windows-msvc`.

WIN_TOOLCHAIN ?= stable-x86_64-pc-windows-msvc

ifeq ($(filter Darwin Linux,$(UNAME)),)
ifneq ($(or $(filter Windows_NT,$(OS)),$(filter MINGW% MSYS% CYGWIN%,$(UNAME))),)
IS_WINDOWS := 1
endif
endif

ifdef IS_WINDOWS

# Step 1: put $CARGO_HOME/bin on PATH and require rustup.
define win_rustup
_ch="$${CARGO_HOME:-$$HOME/.cargo}"; \
if command -v cygpath >/dev/null 2>&1; then _ch="$$(cygpath -u "$$_ch")"; fi; \
export PATH="$$_ch/bin:$$PATH"; \
if ! command -v rustup >/dev/null 2>&1; then \
  echo "ERROR: rustup not found (looked on PATH and in $$_ch/bin)." >&2; \
  echo "  Install it from https://rustup.rs, then run:  rustup toolchain install $(WIN_TOOLCHAIN)" >&2; \
  exit 1; \
fi;
endef

# Steps 2-4.
define win_rust_env
$(win_rustup) \
if ! rustup toolchain list | grep -qE "^$(WIN_TOOLCHAIN)( |$$)"; then \
  echo "ERROR: Rust toolchain '$(WIN_TOOLCHAIN)' is not installed." >&2; \
  echo "  Tauri on Windows needs the MSVC toolchain (the GNU one cannot link the app)." >&2; \
  echo "  Fix:  rustup toolchain install $(WIN_TOOLCHAIN)   (or: make deps)" >&2; \
  echo "  Also needs Visual Studio Build Tools with the 'Desktop development with C++' workload:" >&2; \
  echo "  https://v2.tauri.app/start/prerequisites/#windows" >&2; \
  exit 1; \
fi; \
_bin="$$(rustup which --toolchain $(WIN_TOOLCHAIN) cargo)" || exit 1; \
if command -v cygpath >/dev/null 2>&1; then _bin="$$(cygpath -u "$$_bin")"; fi; \
export PATH="$$(dirname "$$_bin"):$$PATH" RUSTUP_TOOLCHAIN=$(WIN_TOOLCHAIN); \
for _t in cargo rustc; do \
  _h="$$($$_t -vV 2>/dev/null | sed -n 's/^host: //p' | tr -d '\r')"; \
  case "$$_h" in \
    *-msvc) ;; \
    *) echo "ERROR: '$$_t' on PATH targets '$$_h', expected an MSVC host ($(WIN_TOOLCHAIN))." >&2; \
       echo "  Found: $$(command -v $$_t)" >&2; exit 1 ;; \
  esac; \
done; \
echo "-> Rust: $$(rustc -V) [$$_h]";
endef

# $(call RUN,<cmd>) runs <cmd> under the MSVC toolchain. The leading @ keeps make from
# echoing the whole setup script; the command itself is echoed instead.
RUN = @echo '$$ $(1)'; $(win_rust_env) $(1)

# Used by `deps`: ensure the toolchain exists (idempotent), then everything else goes
# through RUN. A guard that fails on a missing toolchain is the wrong shape here.
INSTALL_MSVC = @$(win_rustup) rustup toolchain install $(WIN_TOOLCHAIN)

else

RUN = $(1)
INSTALL_MSVC =

endif

# ─── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help deps dev build mac mac-universal windows \
        linux linux-deb linux-rpm linux-appimage linux-pacman live clean

help:
	@echo "Garita v$(VERSION) — build targets"
	@echo ""
	@echo "  make mac              macOS ARM64 .dmg              (run on macOS)"
	@echo "  make mac-universal    macOS Universal .dmg           (run on macOS)"
	@echo "  make windows          Windows x64 .msi + .exe        (run on Windows)"
	@echo "  make linux            Linux x64 .deb + .rpm + .AppImage  (run on Linux)"
	@echo "  make linux-deb        Linux x64 .deb only            (Debian / Ubuntu)"
	@echo "  make linux-rpm        Linux x64 .rpm only            (Fedora / RHEL / openSUSE)"
	@echo "  make linux-appimage   Linux x64 .AppImage only       (Universal)"
	@echo "  make linux-pacman     Linux x64 .tar.zst only        (Arch Linux)"
	@echo "  make dev              Start dev server (cargo tauri dev)"
	@echo "  make deps             Install platform deps + Rust targets"
	@echo "  make build            Build for the current OS (auto-detect)"
	@echo "  make clean            Remove dist/ and Rust build artifacts"
	@echo ""
	$(if $(IS_WINDOWS),@echo "Windows: run make from PowerShell / cmd / Git Bash. Recipes run under"; echo "  $(SHELL)$(if $(_NATIVE_WIN_MAKE), (override: GIT_BASH=<Git>/usr/bin/bash.exe))."; echo "  dev / windows / deps run Rust under the MSVC toolchain ($(WIN_TOOLCHAIN))"; echo "  automatically. Override with WIN_TOOLCHAIN=...."; echo "")
	@echo "Output paths:"
	@echo "  mac            src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"
	@echo "  mac-universal  src-tauri/target/universal-apple-darwin/release/bundle/dmg/"
	@echo "  windows        src-tauri/target/x86_64-pc-windows-msvc/release/bundle/{msi,nsis}/"
	@echo "  linux          src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/{deb,rpm,appimage}/"
	@echo "  linux-pacman   src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/pacman/"

# ─── Dev ──────────────────────────────────────────────────────────────────────

dev:
	$(call RUN,cargo tauri dev)

# ─── Dependencies ─────────────────────────────────────────────────────────────

deps:
ifeq ($(UNAME), Darwin)
	@echo "→ Installing Rust targets for macOS…"
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	cargo install tauri-cli --version "^2.0" --locked
	npm ci
else ifeq ($(UNAME), Linux)
	@echo "→ Detecting Linux distribution…"
	@if command -v apt-get > /dev/null 2>&1; then \
		echo "→ Debian / Ubuntu — installing packages…"; \
		sudo apt-get update -q; \
		sudo apt-get install -y \
			libwebkit2gtk-4.1-dev \
			libayatana-appindicator3-dev \
			librsvg2-dev \
			patchelf \
			build-essential \
			curl wget file \
			libssl-dev \
			rpm \
			squashfs-tools \
			libfuse2; \
	elif command -v dnf > /dev/null 2>&1; then \
		echo "→ Fedora / RHEL — installing packages…"; \
		sudo dnf install -y \
			webkit2gtk4.1-devel \
			libappindicator-gtk3-devel \
			librsvg2-devel \
			openssl-devel \
			patchelf \
			gcc \
			rpm-build \
			squashfs-tools \
			fuse-libs; \
	elif command -v zypper > /dev/null 2>&1; then \
		echo "→ openSUSE — installing packages…"; \
		sudo zypper install -y \
			webkit2gtk3-devel \
			libappindicator3-devel \
			librsvg-devel \
			libopenssl-devel \
			patchelf \
			gcc \
			rpm-build \
			squashfs; \
	elif command -v pacman > /dev/null 2>&1; then \
		echo "→ Arch Linux — installing packages…"; \
		sudo pacman -Syu --noconfirm \
			webkit2gtk-4.1 \
			libayatana-appindicator \
			librsvg \
			openssl \
			patchelf \
			gcc \
			rpm-tools \
			squashfs-tools \
			fuse2; \
	else \
		echo "⚠  Unknown distro — install Tauri system deps manually:"; \
		echo "   https://v2.tauri.app/start/prerequisites/"; \
	fi
	rustup target add x86_64-unknown-linux-gnu
	cargo install tauri-cli --version "^2.0" --locked
	npm ci
else
	@echo "→ Windows: ensure Rust + MSVC + Node are installed"
	$(INSTALL_MSVC)
	$(call RUN,rustup target add x86_64-pc-windows-msvc)
	$(call RUN,cargo install tauri-cli --version "^2.0" --locked)
	npm ci
endif

# ─── macOS ────────────────────────────────────────────────────────────────────

# Garita ships ad-hoc signed only (no Apple Developer account, no notarization).
# Developer ID signing + notarization was removed on 2026-05-27; do not re-add it.

# $(call mac_sign,<app-path>,<dmg-path>) — ad-hoc sign the .app and recreate the DMG from it.
# NEVER pass --options runtime here: it is valid only with a Developer ID cert and
# Apple rejects it for ad-hoc "-".
define mac_sign
	APP="$(1)"; DMG="$(2)"; \
	echo "→ Ad-hoc signing .app and recreating DMG…"; \
	if [ -n "$$APP" ]; then codesign --sign - --deep --force "$$APP"; fi; \
	if [ -n "$$APP" ] && [ -n "$$DMG" ]; then \
	  rm -f "$$DMG"; \
	  hdiutil create -volname "Garita" -srcfolder "$$APP" -ov -format UDZO "$$DMG"; \
	fi
endef

mac:
ifneq ($(UNAME), Darwin)
	$(error macOS builds must run on macOS)
endif
	@echo "→ Building macOS ARM64 .dmg…"
	npm ci
	cargo tauri build --target aarch64-apple-darwin
	@APP=$$(find src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ -maxdepth 1 -name "*.app" | head -1); \
	 DMG=$$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/ -name "*.dmg" | head -1); \
	 $(call mac_sign,$$APP,$$DMG)
	@echo ""
	@echo "✓ Output: src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/"

mac-universal:
ifneq ($(UNAME), Darwin)
	$(error macOS builds must run on macOS)
endif
	@echo "→ Building macOS Universal (ARM64 + x86_64) .dmg…"
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	npm ci
	cargo tauri build --target universal-apple-darwin
	@APP=$$(find src-tauri/target/universal-apple-darwin/release/bundle/macos/ -maxdepth 1 -name "*.app" | head -1); \
	 DMG=$$(find src-tauri/target/universal-apple-darwin/release/bundle/dmg/ -name "*.dmg" | head -1); \
	 $(call mac_sign,$$APP,$$DMG)
	@echo ""
	@echo "✓ Output: src-tauri/target/universal-apple-darwin/release/bundle/dmg/"

# ─── Windows ──────────────────────────────────────────────────────────────────

windows:
	@echo Building Windows x64 .msi + NSIS installer...
	npm ci
	$(call RUN,cargo tauri build --target x86_64-pc-windows-msvc)
	@echo Done. Output: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/

# ─── Linux ────────────────────────────────────────────────────────────────────

linux:
ifneq ($(UNAME), Linux)
	$(error Linux builds must run on Linux)
endif
	@echo "→ Building Linux x64 .deb + .rpm + .AppImage…"
	npm ci
	APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb,rpm,appimage
	@echo ""
	@echo "✓ deb:      src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/"
	@echo "✓ rpm:      src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/"
	@echo "✓ AppImage: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/"

linux-deb:
ifneq ($(UNAME), Linux)
	$(error Linux builds must run on Linux)
endif
	@echo "→ Building Linux x64 .deb…"
	npm ci
	cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb
	@echo "✓ Output: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/"

linux-rpm:
ifneq ($(UNAME), Linux)
	$(error Linux builds must run on Linux)
endif
	@echo "→ Building Linux x64 .rpm…"
	npm ci
	cargo tauri build --target x86_64-unknown-linux-gnu --bundles rpm
	@echo "✓ Output: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/rpm/"

linux-appimage:
ifneq ($(UNAME), Linux)
	$(error Linux builds must run on Linux)
endif
	@echo "→ Building Linux x64 .AppImage…"
	npm ci
	APPIMAGE_EXTRACT_AND_RUN=1 cargo tauri build --target x86_64-unknown-linux-gnu --bundles appimage
	@echo "✓ Output: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage/"

linux-pacman:
ifneq ($(UNAME), Linux)
	$(error Linux builds must run on Linux)
endif
	@echo "→ Building Linux x64 .tar.zst (pacman)…"
	npm ci
	cargo tauri build --target x86_64-unknown-linux-gnu --bundles pacman
	@echo "✓ Output: src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/pacman/"

# ─── Current OS shortcut ──────────────────────────────────────────────────────

build:
ifeq ($(UNAME), Darwin)
	$(MAKE) mac
else ifeq ($(UNAME), Linux)
	$(MAKE) linux
else
	$(MAKE) windows
endif

# ─── Clean ────────────────────────────────────────────────────────────────────

# Live harness against a throwaway kind cluster (needs Docker). docs/impl/v2.1.2-tasks.md T51-13.
live:
	$(call RUN,"$(SHELL)" scripts/live/run.sh)

clean:
	rm -rf dist
	cargo clean --manifest-path src-tauri/Cargo.toml
