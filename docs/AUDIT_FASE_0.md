# FASE 0 — Auditoria do Estado Atual

> Data: 2026-10-01 · Commit base: `fd550db`

## 1. Arquitetura Existente

```
WEB DISTRIBUIDORA (npm workspaces)
├── packages/shared      tipos, enums, schemas Zod, money, permissions
├── apps/api             Fastify 5 + Prisma + SQLite
│   └── src/
│       ├── lib/         prisma, audit, csv, errors, password, tokens
│       ├── modules/     auth users products stock sales cash
│       │                dashboard reports audit system catalog
│       └── plugins/     auth (JWT + permissões), error-handler
├── apps/web             React 18 + Vite 6 + Tailwind + Recharts
└── apps/desktop         Tauri 2 (wrapper do mesmo frontend)
```

**Separação de responsabilidades: boa.** A API é a única camada que toca o
banco; o frontend consome apenas HTTP. Isso atende ao princípio de
"frontend desacoplado" do documento.

## 2. O que JÁ FUNCIONA (não pode regredir)

| Área | Situação | Evidência |
|---|---|---|
| Banco SQLite + Prisma | OK | `prisma/schema.prisma`, 16 models, FKs, índices |
| Persistência | OK | transação + `VACUUM INTO` no backup |
| Autenticação | OK | bcrypt + JWT access/refresh + revogação real |
| Autorização | OK | `requirePermission` no backend (não só na UI) |
| Produtos | OK | CRUD, CSV import/export, paginação, filtro por estoque |
| Estoque | OK | movimentações append-only, custo médio ponderado, `UPDATE` condicional anti-race |
| Vendas | OK | carrinho → venda transacional → baixa → caixa |
| Caixa | OK | abertura/fechamento, entradas/saídas, sangrias, diferença |
| Dashboard | OK | KPIs reais, séries, comparação com período anterior |
| Relatórios | OK | CSV com colunas configuráveis |
| Auditoria | OK | `recordAudit` com before/after, IP, user-agent |
| Backup/Restore | OK | `.db.gz` + restore pendente aplicado no startup |
| Testes | OK | 46 testes passando (24 shared + 22 api) |

## 3. BUGS E VIOLAÇÕES ENCONTRADOS

### BUG-01 — Duas implementações de scanner (viola §9 "não duplicar lógica")
- `apps/web/src/lib/barcode.ts` → `useBarcodeScanner` (detecção por ritmo, 45ms)
- `apps/web/src/lib/BarcodeContext.tsx` → `BarcodeProvider` (sem detecção de ritmo)
- Duas fontes de verdade para o mesmo hardware. Divergem em detecção,
  validação e contexto.

### BUG-02 — Digitação manual não dispara o BarcodeContext (viola §14)
`BarcodeContext.tsx:90` faz `if (isEditable) return;`. Ao digitar o código no
campo e pressionar ENTER, o contexto **não** dispara — só o hook
`useBarcodeScanner` poderia, mas cada tela usa um ou o outro.

### BUG-03 — Estado global em `window.__barcodeBuffer`
Variável mutável compartilhada, sem reset por tela, sem isolamento.

### BUG-04 — Invalidação de cache de barcode destrói o cache inteiro
`products/routes.ts:49-55` — o laço sobre `id:${id}` é código morto porque a
linha seguinte executa `barcodeCache.clear()` incondicionalmente. Qualquer
edição de produto zera o cache de todos os códigos.

### BUG-05 — Rota `/teste-leitor` fora do layout protegido
`App.tsx:216-223` — declarada após `path="*"` e fora de `<Protected>`/
`<AppLayout>`. Renderiza sem sessão, sem sidebar e sem o layout do sistema.

### BUG-06 — Arquivos de depuração versionados
8 arquivos `test-*.mjs` / `manual-restore.mjs` commitados na raiz e em
`apps/api/`. **Removidos nesta fase.**

## 4. LACUNAS vs. DOCUMENTO

| § | Requisito | Situação |
|---|---|---|
| 5 | `purchase_orders` / `purchase_items` | **AUSENTE** |
| 5 | tabela `backups` | **AUSENTE** (só arquivos em disco) |
| 6 | produto: campo `localização` | **AUSENTE** |
| 18 | tipos de movimento `VENDA` / `CANCELAMENTO` | **AUSENTE** (usa SAIDA/DEVOLUCAO) |
| 20 | sugestão de recompra | **AUSENTE** |
| 21 | fornecedor: prazo médio, qtd. mínima, último preço/data | **AUSENTE** |
| 23 | produtos parados (30/60/90 dias configurável) | **AUSENTE** |
| 25 | sazonalidade / comparação ano × ano | **AUSENTE** |
| 28 | previsão de caixa | **AUSENTE** |
| 31 | exportação de auditoria em PDF | **AUSENTE** (só CSV) |
| 32 | tema claro/escuro/sistema | **AUSENTE** |
| 34 | atalhos de teclado | **AUSENTE** |
| 35 | command palette | **AUSENTE** |
| 36 | toasts centralizados | **AUSENTE** |
| 40-41 | impressora térmica / ESC-POS | **AUSENTE** |
| 42-44 | importação de XML NF-e | **AUSENTE** |
| 54 | tela de backup em Configurações | **AUSENTE** (API existe, UI não) |
| 56 | autorização no backend | **OK** — já implementado |

## 5. BUGS DO AMBIENTE (não do código)

- **Rust/Cargo ausente** — impede `npm run tauri:build`. Dependência de
  sistema, não do repositório. O código Rust está íntegro e versionado.
- `npm run build` na raiz inclui `build:desktop`, que falha sem Rust. O
  build de API e Web é independente e passa.

## 6. LINHA DE BASE FUNCIONAL

```
Testes:  46/46 passando
Build:   shared ✓   api (tsc) ✓   web (tsc + vite) ✓
Runtime: API :3333 (health ok, db up)   Web :5173 (html ok)
Login:   admin / ChangeMe123!   vendedor / vendedor123
Dados:   19 produtos, 1 venda, 18 movimentações (persistem entre restarts)
```

## 7. PLANO DE CORREÇÃO

| Fase | Conteúdo | Risco |
|---|---|---|
| 1 | Schema: `location`, fornecedor compra, `purchase_orders`, `purchase_items`, `backups`, movimentos VENDA/CANCELAMENTO, índices analíticos | Baixo (aditivo) |
| 2 | Produtos: `location`, markup/margem no cadastro | Baixo |
| 3 | **Barcode Manager único** (funde os dois, corrige BUG-01/02/03/05) | Médio |
| 4 | Estoque: recompra, alertas, 최소 config | Baixo |
| 5 | PDV: validações de borda | Baixo |
| 6 | Dashboard: parados, sazonalidade | Médio |
| 7 | UX: tema, toasts, atalhos, command palette, skeletons | Baixo |
| 8 | Inteligência: previsão de caixa, sugestões | Médio |
| 9 | Impressão: ESC/POS local | Baixo |
| 10 | XML NF-e: parser local com prévia | Baixo |
| 11 | WhatsApp: link local sem API paga | Baixo |
| 12 | Auditoria final, testes, docs | — |

## 8. CONCLUSÃO

A base é **sólida** — arquitetura em camadas correta, banco real, autorização
no backend, transactions e testes. Os problemas são **lacunas de features**
(previstas no documento) e **5 bugs de frontend** concentrados no scanner.

Nenhuma regressão de negócio a corrigir. O caminho é aditivo no backend e
refatoração localizada no scanner.
