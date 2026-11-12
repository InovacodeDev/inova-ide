cask "inova-ide" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 arm:   "0000000000000000000000000000000000000000000000000000000000000001",
         intel: "0000000000000000000000000000000000000000000000000000000000000002"

  url "https://github.com/InovacodeDev/inova-ide/releases/download/v#{version}/InovaIDE-#{version}-#{arch}.dmg",
      verified: "github.com/InovacodeDev/inova-ide/"
  name "InovaIDE"
  desc "Multi-account workspace and launcher for Claude, Codex, and Gemini"
  homepage "https://github.com/InovacodeDev/inova-ide"

  livecheck do
    url :url
    strategy :github_latest
  end

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
    Enquanto o InovaIDE não possui notarização Apple, instale e atualize com:
      brew install --cask --no-quarantine InovacodeDev/tap/inova-ide
      brew upgrade --cask --no-quarantine inova-ide

    O comando `inova` foi linkado no PATH junto com o aplicativo.
    Seus dados de contas e sessões ficam em ~/.inova e são preservados em updates.
  EOS
end
