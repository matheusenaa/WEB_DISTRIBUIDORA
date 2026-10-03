# AGENTS.md — WEB DISTRIBUIDORA

Contexto operacional para agentes de IA e para quem desenvolve neste repositório.
O `README.md` continua sendo a referência de produto e negócio; este arquivo cobre
**estrutura, comandos e armadilhas de build**.

---

## O que é

Sistema de gestão para distribuidora: catálogo, estoque, PDV, caixa, comissões,
relatórios e auditoria. Interface em português, dinheiro sempre em centavos
inteiros, layout adaptado para tela de caixa e para desktop (Tauri).

---

## Estrutura (npm workspaces)

| Workspace | Nome | Stack |
| --- | --- | --- |
| `apps/api` | `@webdist/api` | Fastify 5 + Prisma + SQLite, JWT + refresh rotativo, bcrypt |
| `apps/web` | `@webdist/web` | React + Vite |
| `apps/desktop` | `@webdist/desktop` | Tauri 2 (Rust), empacota a API como sidecar |
| `packages/shared` | `@webdist/shared` | Enums, schemas Zod, DTOs, RBAC, dinheiro |

`packages/shared` é a **fonte única de verdade dos contratos**: o backend valida
com os mesmos schemas que o frontend usa nos formulários. Ao adicionar ou mudar um
campo, altere `shared` primeiro — nunca duplique o schema nos dois lados.

### Layout do `apps/api/src`

- `modules/` — auth, users, catalog, products, stock, sales, cash, dashboard,
  reports, audit, system
- `lib/` — prisma, errors, password, csv, audit
- `plugins/` — auth (JWT), error handler
- `tests/` — testes unitários

---

## Comandos

```bash
npm install
npm run setup                 # instala + shared + db:generate + db:push + db:seed

npm run dev                   # API + frontend
npm run dev:api / npm run dev:web

npm run typecheck             # tsc --noEmit em todos os workspaces
npm test                      # unitários (shared + api)
npm run lint

npm run build                 # shared -> api -> web -> desktop
npm run build:shared / build:api / build:web

npm run db:generate | db:push | db:migrate | db:seed | db:reset | db:studio
npm run backup                # VACUUM INTO -> backups/*.db.gz
node scripts/smoke-test.mjs   # E2E, exige a API no ar
```

Primeiro acesso: usuário `admin`, senha `ChangeMe123!` — trocar em *Meu perfil*.

---

## Build desktop (Tauri) — LEIA ANTES

### Ordem obrigatória

`tauri.conf.json` usa `beforeBuildCommand: ""` e `frontendDist: "../../web/dist"`.
Ou seja, **o Tauri não compila o frontend**. Se `apps/web/dist` não existir o build
quebra. Sempre:

```bash
npm run build:shared
npm run build:api
npm run build:web
npm run tauri:build
```

`tauri:build` gera NSIS **e** MSI em
`apps/desktop/src-tauri/target/release/bundle/`. O NSIS usa `installMode: perMachine`
— instalar exige UAC.

### Armadilha 1 — projeto dentro do OneDrive (erro 32)

O repositório mora em `C:\Users\mmath\OneDrive\...`. Compilar Rust ali falha com:

```
error: failed to remove ...\target\release\deps\*.o: O arquivo já está sendo
usado por outro processo. (os error 32)
```

Não é App Control. É o antivírus (`MsMpEng`) segurando o arquivo recém-escrito
durante o scan, num padrão de lock transitório. O build retoma com sucesso a cada
tentativa porque o Cargo reaproveita o cache, mas é lento e frágil.

**Workaround usado com sucesso** — compilar fora do OneDrive:

```powershell
$env:CARGO_TARGET_DIR='C:\Users\mmath\AppData\Local\Temp\opencode\webdist-target'
npm run tauri:build
```

**Pendência:** tornar isso permanente, de preferência em
`apps/desktop/src-tauri/.cargo/config.toml`:

```toml
[build]
target-dir = "C:/Users/mmath/AppData/Local/Temp/opencode/webdist-target"
```

Alternativa aceitável: mover/clonar o repositório para fora do OneDrive.

### Armadilha 2 — Smart App Control bloqueia o build (erro 4551)

Sintoma, com o Smart App Control **ativado**:

```
error: failed to run custom build command for `quote v1.0.47`
Caused by: could not execute process `...\target\release\build\quote-*\build-script-build`
  (never executed)
Caused by: Uma política de Controle de Aplicativo bloqueou este arquivo. (os error 4551)
```

O SAC aplica uma política de assinatura ("Enterprise signing level") e bloqueia os
executáveis de `build-script` que o Cargo acabou de compilar — eles são **novos e
não assinados**. Não há como assinar antes de existir, então todo crate com
`build.rs` morre no primeiro passo.

Confirmação no log:

```powershell
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'; Id=3118}
```

Evento **3118 "Smart App Control Block Details"** — se ele aparecer, é o SAC.
Policy ID observada: `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`.

Para build local, desativar em **Segurança do Windows → Controle de aplicativos e
navegador → Controle de aplicativos → Smart App Control → Desativado**.
Reativar exige *Reset do Windows* — a opção é irreversível pelo caminho normal.
Para gerar o instalador de release, o caminho certo é **assinar o executável**
(certificado Authenticode) e manter o SAC ligado.

### Ordem de diagnóstico de bloqueios de execução

1. `Get-WinEvent ... CodeIntegrity/Operational` → evento **3118** = Smart App Control.
2. Só então verifique política de GPO: `HKLM\SOFTWARE\Policies\Microsoft\Windows\CodeIntegrity`.
3. AppLocker: serviço `AppLockerSvc` instalado? logs em `Microsoft-Windows-AppLocker/*`.

Não desligar Defender nem Firewall para contornar build.

---

## Pendências conhecidas (não assuma que o app instalado funciona)

Build e instaladores **passam**, mas o runtime do sidecar tem defeitos:

1. **`binaries/prisma/migrations` está vazio.** A migration real
   `20261001114453_init_arquitetura_compras` está em `apps/api/prisma/migrations`
   e não é copiada. No SQLite instalado não haverá tabelas → login e produtos
   quebram.
2. **`query_engine-windows.dll.node` não está em `bundle.resources`.** O Prisma
   precisa do engine; `node_modules/.prisma` tem o arquivo, o bundle não copia.
3. **`binaries/api-sidecar.bat` depende de Node do sistema.** Ele procura um
   `node.exe` embutido em `..\..\..\..\nodejs\node.exe` e, se não achar, chama
   `node` do PATH — falha em máquina sem Node instalado.
4. `tauri.conf.json` → `identifier` termina em `.app`, o que a Tauri avisa como
   conflito com a extensão de bundle do macOS.
5. `binaries/` e `release/` são artefatos e estão no `.gitignore`. Gere com
   `npm run sidecar:build` e `npm run tauri:build`.

Instaladores prontos em `release/1.0.0/` (NSIS + MSI, build de 03/10/2026).

---

## Convenções

- **Dinheiro em centavos inteiros.** Nunca float. Erro de centavo em caixa é bug.
- **Margem** sobre o preço de venda: `(preço − custo) / preço`. Markup é sobre custo.
- **Baixa de estoque** só após confirmar a venda. Movimentação manual registra
  estoque anterior, posterior, motivo e responsável.
- **Cancelar venda não apaga caixa**: gera saída compensatória (`SAIDA`/`ESTORNO`).
- **Uma sessão de caixa aberta por vez**; fechamento aceita divergência dentro de
  `CASH_TOLERANCE`.
- Evitar `findMany` sem ordenação; sem query raw específica de SQLite; datas em UTC.
- Perfis: `ADMIN` (total) e `VENDEDOR` (vendas, consulta de produtos/estoque e
  caixa do próprio dia).
- **Segredos** (`.env`, `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`) nunca entram no git.
- Comentários e mensagens de UI em **português**.

## Antes de commitar

```bash
npm run typecheck
npm test
git status        # target/, binaries/ e release/ NÃO devem aparecer
```