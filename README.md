# InovaIDE

Workspace desktop e CLI multi-conta para Claude, Codex e Gemini.

## Plataformas Suportadas

| Plataforma            | Arquitetura | Formato de Distribuição                                  |
| --------------------- | ----------- | -------------------------------------------------------- |
| macOS (Apple Silicon) | `arm64`     | Homebrew Cask (`InovaIDE.app` + CLI `inova`) e `.dmg`    |
| Windows               | `x64`       | Winget (`InovacodeDev.InovaIDE`), `.exe` (NSIS) e `.zip` |
| Linux                 | `x64`       | `.AppImage`, `.deb` e `.tar.gz`                          |

## Instalação e Atualização

### macOS (Apple Silicon via Homebrew)

```bash
brew install --cask InovacodeDev/tap/inova-ide
```

Se o macOS bloquear a abertura por falta de notarização Apple, remova a quarentena após instalar:

```bash
xattr -dr com.apple.quarantine /Applications/InovaIDE.app
```

Para atualizar para a versão mais recente:

```bash
brew update && brew upgrade --cask inova-ide
```

Para remover apenas o aplicativo mantendo contas e sessões em `~/.inova`:

```bash
brew uninstall --cask inova-ide
```

Para remover o aplicativo e apagar todos os dados em `~/.inova`:

```bash
brew uninstall --cask --zap inova-ide
```

### Windows (Winget)

```powershell
winget install InovacodeDev.InovaIDE
```

Para atualizar para a versão mais recente:

```powershell
winget upgrade InovacodeDev.InovaIDE
```

Para remover o aplicativo mantendo contas e sessões em `~/.inova`:

```powershell
winget uninstall InovacodeDev.InovaIDE
```

### Windows e Linux (Downloads Diretos)

Baixe o instalador ou pacote correspondente em [GitHub Releases](https://github.com/InovacodeDev/inova-ide/releases):

- Windows (`x64`): `InovaIDE-<versão>-win-x64.exe` ou `InovaIDE-<versão>-win-x64.zip`
- Linux (`x64`): `InovaIDE-<versão>-linux-x64.AppImage`, `InovaIDE-<versão>-linux-x64.deb` ou `InovaIDE-<versão>-linux-x64.tar.gz`

Cada artefato acompanha um arquivo `.sha256` para verificação de integridade.

## Comandos da CLI (`inova`)

No macOS via Homebrew e no Windows via instalador `.exe` / Winget, o comando `inova` é adicionado automaticamente ao `PATH`.
Em pacotes portáteis de Windows (`.zip`) e Linux, o wrapper fica em `resources/bin/`.

```text
inova account add <claude|codex|gemini> <label>
inova account login <label>
inova account list
inova account rm <label> [--force]
inova project bind <label> [path]
inova project unbind [path]
inova project list
inova run [-- args...]
inova --version
inova --help
```

Contas, vínculos de projetos e sessões ficam em `~/.inova` (ou no caminho definido por `INOVA_HOME`).

## Desenvolvimento Local

Pré-requisitos: Node.js 24+ e `pnpm` 10+.

```bash
pnpm install
pnpm --filter @inova/desktop dev
```

Validações:

```bash
pnpm version:check
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @inova/desktop typecheck && pnpm --filter @inova/desktop test
pnpm format:check
```

Empacotamento local:

```bash
pnpm package:mac
pnpm package:win
pnpm package:linux
```

Para instruções completas de release e manutenção de pacotes, consulte [docs/release-homebrew.md](docs/release-homebrew.md) e [docs/release-winget.md](docs/release-winget.md).
