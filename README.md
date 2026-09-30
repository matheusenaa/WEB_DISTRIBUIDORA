# WEB DISTRIBUIDORA

Sistema completo de gestão para distribuidora: catálogo, estoque, PDV, caixa,
comissões, relatórios e auditoria.

Interface em português, com dinheiro sempre em centavos inteiros, layout
adaptado para tela de caixa (PDV) e para desktop.

---

## Índice

- [Stack](#stack)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Executando](#executando)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Perfis e permissões](#perfis-e-permissões)
- [Regras de negócio](#regras-de-negócio)
- [Banco de dados](#banco-de-dados)
- [Backup](#backup)
- [Testes](#testes)
- [Scripts](#scripts)
- [API](#api)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Segurança](#segurança)

---

## Stack

**Backend**

- Node.js 22+ e TypeScript
- Fastify 5 (HTTP) com Zod para validação de entrada e saída
- Prisma ORM
- SQLite (padrão) ou PostgreSQL
- JWT com access token curto + refresh token rotativo
- bcrypt para hashing de senha
- ExcelJS para exportação `.xlsx`

**Frontend**

- React 18 + TypeScript
- Vite 6
- Tailwind CSS 3
- React Router 6
- TanStack Query 5
- Recharts
- React Hook Form + Zod
- Sonner (notificações)
- lucide-react (ícones)

**Testes**

- Vitest (unitários)
- Script de smoke E2E contra a API real (`scripts/smoke-test.mjs`)

---

## Requisitos

- Node.js **22.5 ou superior** (o backup usa o módulo nativo `node:sqlite`)
- npm 10+

Não é necessário Docker nem PostgreSQL para rodar localmente.

---

## Instalação

```bash
npm run setup
```

Executa, em sequência:

1. `npm install`
2. `npm run db:generate` (gera o Prisma Client)
3. `npm run db:push` (cria o schema no banco)
4. `npm run db:seed` (cria o administrador e os cadastros iniciais)

Para partir do zero com um banco vazio:

```bash
npm run db:reset
npm run db:seed
```

> `db:reset` apaga todos os dados. Use com cuidado.

---

## Executando

Ambiente de desenvolvimento (API e frontend juntos):

```bash
npm run dev
```

- API: <http://localhost:3333>
- Frontend: <http://localhost:5173>

O Vite faz proxy de `/api` para a API, então não é necessário configurar CORS
no uso local.

Para separar os processos:

```bash
npm run dev:api
npm run dev:web
```

### Build de produção

```bash
npm run build          # compila API e frontend
npm start              # executa a API compilada
```

O frontend gera arquivos estáticos em `apps/web/dist`, servíveis por qualquer
servidor web.

### Primeiro acesso

| Campo | Valor |
| --- | --- |
| Usuário | `admin` |
| Senha | `ChangeMe123!` |

**Troque a senha imediatamente** em *Meu perfil*. A senha e as chaves do `.env`
não devem ir para controle de versão.

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. As chaves essentials:

| Variável | Descrição |
| --- | --- |
| `API_PORT` | Porta da API (padrão `3333`) |
| `CORS_ORIGINS` | Origens autorizadas, separadas por vírgula, sem barra final |
| `DATABASE_URL` | `file:./dev.db` (SQLite) ou `postgresql://...` |
| `JWT_SECRET` | Segredo de assinatura — gere um valor aleatório |
| `REFRESH_TOKEN_PEPPER` | Pepper do refresh token — **diferente** do `JWT_SECRET` |
| `ALLOW_NEGATIVE_STOCK` | Permite venda com estoque negativo |
| `SELLER_MAX_DISCOUNT_PERCENT` | Desconto máximo do vendedor sem autorização |
| `ADMIN_MAX_DISCOUNT_PERCENT` | Desconto máximo do administrador |
| `CASH_TOLERANCE` | Tolerância de divergência de caixa, em reais |
| `BARCODE_CACHE_TTL_SECONDS` | Validade do cache de busca por código de barras |
| `SEED_DEMO_SALES` | Cria vendas de demonstração no seed |

Gere segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Vendas de demonstração só são criadas com `SEED_DEMO_SALES=true`; em produção,
deixe desabilitado.

---

## Estrutura do projeto

```
.
├── apps/
│   ├── api/                  # Fastify + Prisma
│   │   ├── prisma/           # schema.prisma, seed.ts, dev.db
│   │   └── src/
│   │       ├── modules/      # auth, users, catalog, products, stock,
│   │       │                 # sales, cash, dashboard, reports, audit, system
│   │       ├── lib/          # prisma, errors, password, csv, audit
│   │       └── plugins/      # auth (JWT), error handler
│   │   └── tests/            # testes unitários
│   └── web/                  # React + Vite
│       └── src/
│           ├── components/   # UI compartilhada, layout, protecao de rota
│           ├── lib/          # api client, auth, formatadores, leitor de barcode
│           └── pages/        # uma pagina por area
├── packages/
│   └── shared/               # contratos: enums, schemas Zod, DTOs, RBAC, dinheiro
├── scripts/
│   ├── smoke-test.mjs        # E2E contra a API real
│   └── backup.mjs            # backup do SQLite
└── backups/                  # backups gerados (fora do git)
```

O pacote `shared` é a fonte única de verdade dos contratos: o backend valida
com os mesmos schemas que o frontend usa nos formulários, então erro de
validação aparece igual nos dois lados.

---

## Perfis e permissões

Dois perfis:

- **ADMIN** — acesso total.
- **VENDEDOR** — apenas vendas, consulta de produtos/estoque e caixa do próprio
  dia.

O vendedor vê o dashboard escopado às próprias vendas. Descontos acima do
limite configurado são recusados pela API, independentemente do que a tela
permita.

A matriz completa fica em `packages/shared/src/permissions.ts`. A API valida
permissão em **todas** as rotas — esconder um botão na interface nunca é a
proteção real.

---

## Regras de negócio

**Dinheiro**

Todo valor monetário é armazenado e calculado em **centavos inteiros**. Nenhuma
operação usa float para dinheiro. Isso elimina divergência de centavo em caixa.

**Margem**

- Margem é calculada sobre o **preço de venda**: `(preço − custo) / preço`.
- Markup é o multiplicador sobre o custo.

Exemplo: custo R$ 10,00 vendido a R$ 25,00 → margem de **60%**, lucro R$ 15,00.

**Estoque**

Baixa só acontece após a confirmação da venda. Movimentações manuais registram
estoque anterior e posterior, motivo e responsável.

**Vendas**

- Status: `PENDENTE` → `CONCLUIDA` / `CANCELADA`.
- Cancelar não apaga a entrada de caixa original: é registrada uma saída
  compensatória (`SAIDA` / `ESTORNO`), preservando o histórico e a conciliação.

**Caixa**

Há um sessão aberta por vez. O fechamento compara o valor informado com o
esperado (inicial + entradas − saídas) e aceita uma diferença dentro da
tolerância configurada.

---

## Banco de dados

Padrão SQLite, arquivo em `apps/api/prisma/dev.db`.

Para PostgreSQL, altere o schema de acordo com a documentação do Prisma e ajuste
`DATABASE_URL`. O código da aplicação não depende do banco escolhido — evita
`findMany` sem ordenação, não usa consultas raw específicas de SQLite e trata
datas em UTC.

---

## Backup

```bash
npm run backup                 # cria backups/webdist-AAAA-MM-DD-HHMMSS.db.gz
npm run backup -- --keep 10    # mantém apenas os 10 mais recentes
```

O script usa `VACUUM INTO`, que gera uma cópia consistente mesmo com a API
escrevendo no banco — uma cópia direta do arquivo poderia capturar um estado
intermediário por causa do journal (WAL).

Os backups são comprimidos com gzip e ficam em `backups/`, fora do git.

Para restaurar:

```bash
# pare a API antes de restaurar
gunzip -c backups/webdist-20250101-120000.db.gz > apps/api/prisma/dev.db
```

Para PostgreSQL, use `pg_dump` / `pg_restore` — o script detecta que a URL não é
SQLite e orienta a usar a ferramenta nativa.

---

## Testes

```bash
npm test          # unitários (shared + api)
npm run typecheck # TypeScript em todos os workspaces
npm run build     # build de produção
```

Smoke test end-to-end (exige a API em execução):

```bash
node scripts/smoke-test.mjs
```

O smoke test sobe com um usuário administrativo, cria produto, venda, movimenta
caixa, cancela, exporta relatório e confere auditoria — verificando também
que vendedor não acessa dados de outro usuário.

---

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | API e frontend em desenvolvimento |
| `npm run dev:api` / `dev:web` | Sobe apenas um deles |
| `npm run build` | Compila API e frontend |
| `npm start` | Executa a API compilada |
| `npm test` | Testes unitários |
| `npm run typecheck` | Checagem de tipos |
| `npm run lint` | Lint (quando configurado) |
| `npm run backup` | Backup do banco |
| `npm run setup` | Instala, cria schema e popula |
| `npm run db:generate` | Gera o Prisma Client |
| `npm run db:push` | Sincroniza schema sem migração |
| `npm run db:migrate` | Cria/aplica migração |
| `npm run db:seed` | Popula dados iniciais |
| `npm run db:reset` | Apaga e recria o banco |
| `npm run db:studio` | Prisma Studio |

---

## API

Base: `/api`. Respostas de lista usam `{ data, pagination }`; erros seguem
`{ error: { code, message, requestId, fieldErrors? } }`.

<details>
<summary>Endpoints principais</summary>

**Auth** — `POST /api/auth/login`, `POST /api/auth/refresh`,
`POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/password`

**Usuários** — `GET|POST /api/users`, `GET|PATCH|DELETE /api/users/:id`,
`POST /api/users/:id/status`

**Catálogo** — `GET|POST /api/categories`, `GET|POST /api/brands`,
`GET|POST /api/suppliers`, `GET|POST /api/customers` (com paginação, busca e
ativação/desativação)

**Produtos** — `GET|POST /api/products`, `GET|PATCH|DELETE /api/products/:id`,
`POST /api/products/:id/status`, `GET /api/products/barcode/:code`,
`GET /api/products/export/csv`, `POST /api/products/import/csv`

**Estoque** — `GET /api/stock/movements`, `POST /api/stock/movements`,
`GET /api/stock/alerts`

**Vendas** — `GET|POST /api/sales`, `GET /api/sales/:id`,
`POST /api/sales/:id/cancel`

**Caixa** — `GET /api/cash/current`, `POST /api/cash/open`,
`GET /api/cash/sessions`, `GET /api/cash/sessions/:id`, `POST /api/cash/entries`,
`POST /api/cash/exits`, `POST /api/cash/close`

**Dashboard** — `GET /api/dashboard`

**Relatórios** — `GET /api/reports/available`, `GET /api/reports/:key`
(parâmetros `from`, `to`, `format=csv|xlsx`, `sellerId`)

**Auditoria** — `GET /api/audit`, `GET /api/audit/actions`,
`GET /api/audit/export/csv`

**Sistema** — `GET /api/system/settings`, `PATCH /api/system/settings`

</details>

Além de `vendas`, há os relatórios `produtos`, `estoque`, `movimentacao`,
`caixa`, `vendedores`, `faturamento`, `mais-vendidos` e `produtos-parados`.

---

## Atalhos de teclado

| Atalho | Ação |
| --- | --- |
| `F2` | Inicia uma nova venda no PDV |
| `F4` | Abre o pagamento da venda |
| `F8` | Esvazia o carrinho (pede confirmação) |
| `Esc` | Fecha o modal aberto |

Leitores de código de barras no padrão HID (keyboard wedge) funcionam sem
driver: basta focar o campo de busca e bipar.

---

## Segurança

Implementado:

- Senhas com bcrypt (custo alto), nunca retornadas pela API
- Refresh tokens rotativos, armazenados com hash + pepper, revogáveis
- Revogação de sessões ao trocar senha, alterar perfil ou bloquear usuário
- Trava contra remoção do último administrador ativo
- RBAC aplicado no servidor em todas as rotas
- Rate limit no login
- Helmet, CORS com lista explícita e limites de payload
- Auditoria de operações sensíveis (criação, alteração, exclusão, exportações,
  cancelamentos)
- Redirecionamento de queries parametrizado (sem concatenação de SQL)

Antes de colocar em produção:

1. Gere `JWT_SECRET` e `REFRESH_TOKEN_PEPPER` próprios e diferentes
2. Troque a senha do administrador
3. Ajuste `CORS_ORIGINS` para os domínios reais
4. Sirva o frontend por HTTPS
5. Restrinja o acesso ao banco e faça backup automático
6. Não rode com `SEED_DEMO_SALES=true`