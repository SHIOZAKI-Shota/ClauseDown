cask "clausedown" do
  version "0.7.0"
  sha256 "62af748bc38ea80f7bdc77fd280321b05e7db0c3fc5a26b17ec29bb0cfa4b2b4"

  url "https://github.com/SHIOZAKI-Shota/ClauseDown/releases/download/v#{version}/ClauseDown-#{version}-arm64.dmg",
      verified: "github.com/SHIOZAKI-Shota/ClauseDown/"
  name "ClauseDown"
  desc "Editor for legal documents written in Markdown and managed with Git"
  homepage "https://clausedown.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "ClauseDown.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/ClauseDown.app"]
  end

  zap trash: [
    "~/Library/Application Support/clausedown",
    "~/Library/Preferences/com.clausedown.app.plist",
    "~/Library/Saved Application State/com.clausedown.app.savedState",
  ]
end
