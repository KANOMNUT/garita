cask "garita" do
  version "2.4.1"
  # Bumped by hand at release: set version, then sha256 from the release's SHA256SUMS.txt.
  sha256 "3e51d0bcb413363a7c609306936f676e473a61050d551961f881173a5e642f4b"

  url "https://github.com/KANOMNUT/garita/releases/download/v#{version}/Garita-macOS-arm64.dmg"
  name "Garita"
  desc "Kubernetes cluster management desktop app"
  homepage "https://github.com/KANOMNUT/garita"
  # The app updates itself (Settings → Updates).
  auto_updates true

  # The published DMG is Apple Silicon only.
  depends_on arch: :arm64
  depends_on macos: ">= :monterey"

  app "Garita.app"
  binary "#{appdir}/Garita.app/Contents/MacOS/garita"

  # Ad-hoc signed, not notarized: clear the quarantine flag.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-rd", "com.apple.quarantine", "#{appdir}/Garita.app"]
  end

  # New identifier only: never the legacy com.watchtower.app dirs, so removing
  # Garita never destroys a still-installed v1.
  zap trash: [
    "~/Library/Application Support/io.github.kanomnut.garita",
    "~/Library/Caches/io.github.kanomnut.garita",
    "~/Library/Logs/io.github.kanomnut.garita",
    "~/Library/Saved Application State/io.github.kanomnut.garita.savedState",
    "~/Library/WebKit/io.github.kanomnut.garita",
  ]
end
