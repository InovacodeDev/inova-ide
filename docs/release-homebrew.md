# Deploy, Manutenção e Update via Homebrew

Este guia descreve a configuração inicial, publicação de releases, atualização de usuários, rollback e migração para assinatura Apple do InovaIDE.

## 1. Configuração Inicial (Uma Vez)

Execute estes passos antes do primeiro release:

1. Crie o repositório público `InovacodeDev/inova-ide` no GitHub e envie este código para `main`.
2. Crie o repositório público `InovacodeDev/homebrew-tap` no GitHub.
3. Copie `packaging/homebrew/Casks/inova-ide.rb` para `Casks/inova-ide.rb` no `homebrew-tap`.
4. Copie `packaging/homebrew/.github/workflows/ci.yml` para `.github/workflows/ci.yml` no `homebrew-tap`.
5. Gere um Fine-Grained PAT com permissão `Contents: Read and write` apenas em `InovacodeDev/homebrew-tap`.
6. Salve esse token no repositório `InovacodeDev/inova-ide` como secret `HOMEBREW_TAP_TOKEN`.

## 2. Fluxo de Release e Update

Siga esta sequência para publicar qualquer versão nova:

1. Atualize a versão sincronizada nos dois `package.json`:
   ```bash
   pnpm version:bump patch
   ```
   Use `minor` ou `major` conforme a mudança.
2. Valide os checks locais:
   ```bash
   pnpm version:check
   pnpm typecheck && pnpm lint && pnpm test
   pnpm --filter @inova/desktop typecheck && pnpm --filter @inova/desktop test
   ```
3. Crie o commit de release, aplique a tag e envie ao GitHub:
   ```bash
   git add package.json apps/desktop/package.json
   git commit -m "chore: release vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```
4. Acompanhe o workflow `.github/workflows/release.yml`:
   - Compila e testa os DMGs `arm64` (`macos-15`) e `x64` (`macos-15-intel`).
   - Executa `INOVA_SELFTEST=1` e `inova --version` dentro dos `.app` empacotados.
   - Publica o GitHub Release com os `.dmg` e `.sha256`.
   - Atualiza `Casks/inova-ide.rb` no `InovacodeDev/homebrew-tap` após rodar `brew style` e `brew audit --cask`.

## 3. Comandos do Usuário Final (Homebrew)

| Ação | Comando |
| --- | --- |
| Instalar | `brew install --cask --no-quarantine InovacodeDev/tap/inova-ide` |
| Atualizar | `brew update && brew upgrade --cask --no-quarantine inova-ide` |
| Verificar versão CLI | `inova --version` |
| Remover app (mantém `~/.inova`) | `brew uninstall --cask inova-ide` |
| Remover tudo (apaga `~/.inova`) | `brew uninstall --cask --zap inova-ide` |

## 4. Manutenção e Rollback

- **ATENÇÃO:** Nunca mova ou sobrescreva uma tag `vX.Y.Z` já publicada. O Homebrew valida o `sha256` em cache e falha quando o arquivo muda na mesma URL.
- Para reverter uma versão com regressão no tap, reverta o commit mais recente em `InovacodeDev/homebrew-tap` ou publique um novo patch `vX.Y.(Z+1)`.
- Use `brew livecheck --cask InovacodeDev/tap/inova-ide` para auditar se o tap acompanha o último GitHub Release.

## 5. Build Local para Diagnóstico

Gere o DMG da arquitetura atual localmente:

```bash
pnpm package:mac
```

Os arquivos ficam em `release/InovaIDE-<version>-<arch>.dmg` e `release/InovaIDE-<version>-<arch>.dmg.sha256`.

## 6. Migração para Assinatura Apple e Notarização

Quando possuir um certificado `Developer ID Application`:

1. Adicione estes secrets em `InovacodeDev/inova-ide`:
   - `CSC_LINK` (certificado `.p12` em base64)
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
2. O workflow `.github/workflows/release.yml` e `apps/desktop/scripts/after-pack.mjs` detectam `CSC_LINK` automaticamente e usam assinatura oficial com `build/entitlements.mac.plist`.
3. Remova `--no-quarantine` da seção `caveats` em `Casks/inova-ide.rb` e da tabela de comandos acima.
