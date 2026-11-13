cask "inova-ide" do
  version "0.1.0"
  sha256 "5f7d4c561040147bc4010b4caf546ccc7745db8e38d3bafb95934739feb9b14b"

  url "https://github.com/InovacodeDev/inova-ide/releases/download/v#{version}/InovaIDE-#{version}-arm64.dmg"
  name "InovaIDE"
  desc "Multi-account workspace and launcher for Claude, Codex, and Gemini"
  homepage "https://github.com/InovacodeDev/inova-ide"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "InovaIDE.app"
  binary "#{appdir}/InovaIDE.app/Contents/Resources/bin/inova"

  zap trash: [
    "~/.inova",
    "~/Library/Application Support/InovaIDE",
    "~/Library/Caches/com.inovacode.inova-ide",
    "~/Library/Caches/com.inovacode.inova-ide.ShipIt",
    "~/Library/Logs/InovaIDE",
    "~/Library/Preferences/com.inovacode.inova-ide.plist",
    "~/Library/Saved Application State/com.inovacode.inova-ide.savedState",
  ]

  caveats <<~EOS
    Enquanto o InovaIDE não possui notarização Apple, remova a quarentena se o macOS bloquear a abertura:
      xattr -dr com.apple.quarantine "#{appdir}/InovaIDE.app"

    O comando `inova` foi linkado no PATH junto com o aplicativo.
    Seus dados de contas e sessões ficam em ~/.inova e são preservados em updates.
  EOS
end
