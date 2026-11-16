# Deploy, Manutenção e Update via Winget

Este guia descreve a configuração inicial, submissão do primeiro pacote, automação de releases, atualização de usuários e rollback do InovaIDE no Winget (`microsoft/winget-pkgs`).

## 1. Configuração Inicial (Uma Vez)

Execute estes passos antes de ativar a publicação automática no Winget:

1. Crie um fork público de `microsoft/winget-pkgs` na conta ou organização que abrirá os Pull Requests.
2. Publique um release no GitHub contendo o instalador Windows com `nsis.guid` e `installer.nsh` configurados.
3. Baixe o artifact `winget-manifest` gerado no workflow `.github/workflows/release.yml` (ou gere localmente com `node scripts/winget-manifest.mjs --version X.Y.Z --sha256-file release/InovaIDE-X.Y.Z-win-x64.exe.sha256`).
4. Copie os 4 arquivos YAML para `manifests/i/InovacodeDev/InovaIDE/X.Y.Z/` no seu fork de `microsoft/winget-pkgs`.
5. Abra o primeiro Pull Request para `microsoft/winget-pkgs` e assine o **Microsoft CLA** quando solicitado pelo bot do PR.
6. Aguarde a aprovação do pipeline `Windows Package Manager` e o merge do primeiro PR.
7. Gere um **Classic Personal Access Token (PAT)** no GitHub com os escopos `public_repo` e `workflow` (tokens fine-grained não são aceitos pelo `vedantmgoyal9/winget-releaser`).
8. Salve o token no repositório `InovacodeDev/inova-ide` como secret `WINGET_TOKEN`.
9. Crie a Repository Variable `WINGET_ENABLED` com valor `true` em **Settings > Secrets and variables > Actions > Variables**.

## 2. Fluxo Automático de Release

Após a configuração inicial, cada nova tag `vX.Y.Z` executa automaticamente estes passos em `.github/workflows/release.yml`:

1. O job `build` (`windows-latest`) gera `InovaIDE-X.Y.Z-win-x64.exe` e `InovaIDE-X.Y.Z-win-x64.zip`.
2. O script `apps/desktop/scripts/smoke-win.ps1` valida o `.zip`, executa a instalação silenciosa `/S` do `.exe`, verifica a chave de registro `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\d7a4c9e2-6b3f-4c81-9f2a-1e5b8a4d7c03`, testa `inova.cmd` no `PATH` do usuário e valida a desinstalação limpa.
3. O job gera os manifestos YAML via `scripts/winget-manifest.mjs` e executa `winget validate --manifest`.
4. Após `publish-release` publicar os binários no GitHub Releases, o job `update-winget` executa `vedantmgoyal9/winget-releaser@main` e abre um Pull Request automático em `microsoft/winget-pkgs`.

## 3. Comandos do Usuário Final (Winget)

| Ação | Comando |
| --- | --- |
| Instalar | `winget install InovacodeDev.InovaIDE` |
| Atualizar | `winget upgrade InovacodeDev.InovaIDE` |
| Verificar versão CLI | `inova --version` |
| Remover app (mantém `~/.inova`) | `winget uninstall InovacodeDev.InovaIDE` |

## 4. Manutenção e Rollback

- **ATENÇÃO:** Nunca mova ou sobrescreva uma tag `vX.Y.Z` já publicada. O Winget valida o `InstallerSha256` em `microsoft/winget-pkgs` e rejeita pacotes cujo binário diverge do hash publicado.
- Para corrigir uma versão com regressão, publique um novo patch `vX.Y.(Z+1)` pelo fluxo normal (`pnpm version:deploy patch`) ou abra um PR removendo a versão com problema em `microsoft/winget-pkgs`.
- Em atualizações iniciadas dentro do aplicativo no Windows, o InovaIDE consulta `winget show --id InovacodeDev.InovaIDE --exact --versions` e só inicia o upgrade em segundo plano quando a nova versão já está disponível no índice do Winget.

## 5. Assinatura Digital Windows (Authenticode)

Atualmente o instalador Windows não possui certificado Authenticode, portanto o Windows Defender SmartScreen pode exibir aviso em instalações iniciais.

Quando possuir um certificado Code Signing (ou Azure Trusted Signing):

1. Configure os secrets de assinatura esperados pelo `electron-builder` no job `build` (`windows-latest`) de `.github/workflows/release.yml`.
2. Teste uma instalação silenciosa em máquina Windows limpa para confirmar ausência de bloqueios de SmartScreen.
