#!/usr/bin/env node
/**
 * Teste de fumaca ponta a ponta contra a API em execucao.
 *
 * Valida o fluxo REAL: login -> produtos -> estoque -> venda -> baixa de
 * estoque -> caixa -> relatorio -> dashboard -> permissao de vendedor.
 *
 * Uso:  node scripts/smoke-test.mjs
 *       BASE_URL=http://127.0.0.1:3333 node scripts/smoke-test.mjs
 */
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3333').replace(/\/$/, '');
const USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

let passed = 0;
let failed = 0;
const failures = [];

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${c.green('PASSOU')}  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  ${c.red('FALHOU')}  ${name} ${c.dim(detail)}`);
  }
}

function section(title) {
  console.log(`\n${c.bold(title)}`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, data };
}

const money = (cents) => (cents / 100).toFixed(2);

/** EAN-13 valido a partir de 12 digitos base, para o teste ser reexecutavel. */
function ean13(base12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${base12}${(10 - (sum % 10)) % 10}`;
}

/** Codigo unico por execucao, para o smoke test poder rodar quantas vezes quiser. */
const runStamp = String(Date.now()).slice(-10);
const TEST_BARCODE = ean13(`99${runStamp}`);
const MISSING_BARCODE = ean13(`88${runStamp}`);

async function main() {
  console.log(c.bold('\n=============================================================='));
  console.log(c.bold(' WEB DISTRIBUIDORA - Teste ponta a ponta'));
  console.log(c.bold(` Alvo: ${BASE}`));
  console.log(c.bold('==============================================================\n'));

  /* -------------------------------------------------------------- */
  section('1. Saude e disponibilidade do banco');
  const health = await api('/api/health');
  check('GET /api/health responde 200', health.status === 200, `status ${health.status}`);
  check('Banco de dados online', health.data?.database?.status === 'up', JSON.stringify(health.data?.database));
  check('Ambiente reportado', typeof health.data?.version === 'string');

  /* -------------------------------------------------------------- */
  section('2. Protecao de rota sem autenticacao');
  const noAuth = await api('/api/products');
  check('GET /api/products sem token retorna 401', noAuth.status === 401, `status ${noAuth.status}`);
  check(
    'Mensagem de erro e amigavel (sem stack trace)',
    typeof noAuth.data?.error?.message === 'string' && !JSON.stringify(noAuth.data).includes('at '),
    noAuth.data?.error?.message,
  );

  const badToken = await api('/api/products', { token: 'token.invalido.aqui' });
  check('Token invalido retorna 401', badToken.status === 401, `status ${badToken.status}`);

  /* -------------------------------------------------------------- */
  section('3. Login');
  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: USERNAME, password: 'senha-errada-123' },
  });
  check('Senha incorreta retorna 401', badLogin.status === 401, `status ${badLogin.status}`);
  check(
    'Nao revela se o usuario existe',
    badLogin.data?.error?.message === 'Usuario ou senha incorretos.',
    badLogin.data?.error?.message,
  );

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: USERNAME, password: PASSWORD },
  });
  check('Login do administrador retorna 200', login.status === 200, JSON.stringify(login.data?.error));
  const token = login.data?.tokens?.accessToken;
  const refreshToken = login.data?.tokens?.refreshToken;
  check('Token de acesso emitido', typeof token === 'string' && token.length > 20);
  check('Token de renovacao emitido', typeof refreshToken === 'string' && refreshToken.length > 20);
  check('Perfil ADMIN reconhecido', login.data?.user?.role === 'ADMIN', login.data?.user?.role);
  check('Permissoes entregues no login', Array.isArray(login.data?.user?.permissions) && login.data.user.permissions.length > 20);
  check(
    'Senha com hash nunca e devolvida',
    !JSON.stringify(login.data).toLowerCase().includes('passwordhash'),
  );
  if (!token) {
    console.log(c.red('\nAbortando: login falhou.\n'));
    process.exit(1);
  }

  /* -------------------------------------------------------------- */
  section('4. Sessao e renovacao de token');
  const me = await api('/api/auth/me', { token });
  check('GET /api/auth/me retorna o usuario', me.status === 200 && me.data?.username === USERNAME);

  const refreshed = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  check('Renovacao de token retorna 200', refreshed.status === 200, `status ${refreshed.status}`);
  const newRefresh = refreshed.data?.tokens?.refreshToken;
  check('Token de renovacao e rotacionado', newRefresh && newRefresh !== refreshToken);

  const reuse = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
  check('Token de renovacao usado e rejeitado na segunda tentativa', reuse.status === 401, `status ${reuse.status}`);

  /* -------------------------------------------------------------- */
  section('5. Catalogo e produtos');
  const meta = await api('/api/meta');
  check('GET /api/meta responde', meta.status === 200);
  check('Formas de pagamento vindas do servidor', Array.isArray(meta.data?.enums?.paymentMethods) && meta.data.enums.paymentMethods.length > 0);
  check('Unidades de medida vindas do servidor', Array.isArray(meta.data?.enums?.units) && meta.data.enums.units.length > 0);

  const barcode = TEST_BARCODE;
  const created = await api('/api/products', {
    method: 'POST',
    token,
    body: {
      name: `Produto Teste ${runStamp}`,
      barcode,
      costPrice: '10,00',
      salePrice: '25,00',
      stock: 100,
      minStock: 10,
      unit: 'UN',
    },
  });
  check('POST /api/products cria produto', created.status === 201, JSON.stringify(created.data?.error));
  const productId = created.data?.id;
  check('Estoque inicial gravado', created.data?.stock === 100, `stock ${created.data?.stock}`);
  check('Preco lido do servidor em centavos', created.data?.salePrice === 2500, `salePrice ${created.data?.salePrice}`);
  check('Custo convertido de "10,00" para 1000', created.data?.costPrice === 1000, `costPrice ${created.data?.costPrice}`);
  // Margem sobre o preco de venda: (25,00 - 10,00) / 25,00 = 60%.
  // (o markup correspondente seria 150%: (25,00 - 10,00) / 10,00)
  check('Margem de venda calculada sobre o preco (60%)', Math.abs((created.data?.marginPercent ?? 0) - 60) < 0.01, `margem ${created.data?.marginPercent}`);

  const dupBarcode = await api('/api/products', {
    method: 'POST',
    token,
    body: { name: 'Duplicado', barcode, costPrice: '1,00', salePrice: '2,00' },
  });
  check('Codigo de barras duplicado e bloqueado', dupBarcode.status === 409, `status ${dupBarcode.status}`);

  const invalid = await api('/api/products', {
    method: 'POST',
    token,
    body: { name: 'x', costPrice: 'abc', salePrice: '1,00' },
  });
  check('Dados invalidos retornam 422', invalid.status === 422, `status ${invalid.status}`);
  check(
    'Validacao lista os campos com problema',
    Array.isArray(invalid.data?.error?.details?.issues) && invalid.data.error.details.issues.length > 0,
  );

  const list = await api('/api/products?perPage=5', { token });
  check('Listagem de produtos paginada', list.status === 200 && Array.isArray(list.data?.data));
  check('Paginacao traz total', typeof list.data?.pagination?.total === 'number', `total ${list.data?.pagination?.total}`);

  /* -------------------------------------------------------------- */
  section('6. Leitor de codigo de barras');
  const scan = await api(`/api/products/barcode/${barcode}`, { token });
  check('Leitura de codigo de barras encontra o produto', scan.data?.found === true, JSON.stringify(scan.data));
  check('Produto lido tem preco', scan.data?.product?.salePrice === 2500);

  const scanAgain = await api(`/api/products/barcode/${barcode}`, { token });
  check('Segunda leitura vem do cache', scanAgain.data?.source === 'cache', `source ${scanAgain.data?.source}`);

  const notFound = await api(`/api/products/barcode/${MISSING_BARCODE}`, { token });
  check('Codigo inexistente retorna found=false', notFound.data?.found === false);

  const search = await api(`/api/products/search?q=Produto%20Teste`, { token });
  check('Busca por nome funciona', search.status === 200 && search.data?.data?.length > 0);

  /* -------------------------------------------------------------- */
  section('7. Movimentacao de estoque');
  const entry = await api('/api/stock/movements', {
    method: 'POST',
    token,
    body: { type: 'ENTRADA', productId, quantity: 50, reason: 'Compra NF 12345', documentNumber: '12345', unitCost: '9,50' },
  });
  check('Entrada de estoque registrada', entry.status === 201, JSON.stringify(entry.data?.error));
  check('Estoque subiu de 100 para 150', entry.data?.resultingStock === 150, `resultante ${entry.data?.resultingStock}`);

  const tooMuch = await api('/api/stock/movements', {
    method: 'POST',
    token,
    body: { type: 'SAIDA', productId, quantity: 9999, reason: 'Teste de limite' },
  });
  check('Saida maior que o estoque e bloqueada', tooMuch.status === 409, `status ${tooMuch.status}`);
  check('Mensagem informa estoque insuficiente', /insuficiente/i.test(tooMuch.data?.error?.message ?? ''), tooMuch.data?.error?.message);

  const adjust = await api('/api/stock/adjust', {
    method: 'POST',
    token,
    body: { productId, targetStock: 300, reason: 'Contagem fisica' },
  });
  check('Ajuste para estoque alvo funciona', adjust.data?.resultingStock === 300, `resultante ${adjust.data?.resultingStock}`);

  const movements = await api(`/api/stock/movements?productId=${productId}`, { token });
  check('Historico de movimentacoes registrado', movements.data?.data?.length >= 3, `${movements.data?.data?.length} registros`);
  const hasInitial = movements.data?.data?.some((m) => m.reason?.includes('Estoque inicial'));
  const hasPurchase = movements.data?.data?.some((m) => m.reason?.includes('Compra NF 12345'));
  const hasAdjust = movements.data?.data?.some((m) => m.reason?.includes('Contagem fisica'));
  check('Historico preserva estoque inicial, compra e ajuste', hasInitial && hasPurchase && hasAdjust);

  const alerts = await api('/api/stock/alerts', { token });
  check('Endpoint de alertas de estoque responde', alerts.status === 200 && Array.isArray(alerts.data?.data));

  /* -------------------------------------------------------------- */
  section('8. Fluxo de caixa');
  const cashOpen = await api('/api/cash/open', { method: 'POST', token, body: { initialAmountCents: 10000 } });
  check('Abertura de caixa registra saldo inicial', cashOpen.status === 201, JSON.stringify(cashOpen.data?.error));
  const cashSessionId = cashOpen.data?.session?.id;

  const cashOpen2 = await api('/api/cash/open', { method: 'POST', token, body: { initialAmountCents: 5000 } });
  check('Segundo caixa aberto e bloqueado', cashOpen2.status === 409, `status ${cashOpen2.status}`);

  /* -------------------------------------------------------------- */
  section('9. Venda / PDV');
  const stockBefore = (await api(`/api/products/${productId}`, { token })).data?.stock;

  const sale = await api('/api/sales', {
    method: 'POST',
    token,
    body: {
      items: [{ productId, quantity: 3 }],
      paymentMethod: 'DINHEIRO',
      amountPaidCents: 10000,
    },
  });
  check('POST /api/sales registra venda', sale.status === 201, JSON.stringify(sale.data?.error));
  const saleNumber = sale.data?.number;
  check('Venda recebeu numero sequencial', typeof saleNumber === 'number' && saleNumber > 0, `numero ${saleNumber}`);
  check('Total calculado no servidor: 3 x 25,00 = 75,00', sale.data?.total === 7500, `total ${money(sale.data?.total ?? 0)}`);
  check('Troco calculado: 100,00 - 75,00 = 25,00', sale.data?.changeCents === 2500, `troco ${money(sale.data?.changeCents ?? 0)}`);
  check('Venda lancada no caixa aberto', sale.data?.cashSessionId === cashSessionId, `caixa ${sale.data?.cashSessionId}`);

  const productAfter = (await api(`/api/products/${productId}`, { token })).data;
  check(
    'Estoque baixou de 300 para 297',
    productAfter?.stock === 297,
    `antes ${stockBefore}, depois ${productAfter?.stock}`,
  );

  const overSale = await api('/api/sales', {
    method: 'POST',
    token,
    body: { items: [{ productId, quantity: 10000 }], paymentMethod: 'DINHEIRO' },
  });
  check('Venda sem estoque e bloqueada', overSale.status === 409, `status ${overSale.status}`);
  check('Mensagem explica estoque insuficiente', /insuficiente/i.test(overSale.data?.error?.message ?? ''));

  const quote = await api('/api/sales/quote', {
    method: 'POST',
    token,
    body: { items: [{ productId, quantity: 2 }], paymentMethod: 'PIX' },
  });
  check('Simulacao de venda nao grava nada', quote.status === 200, `status ${quote.status}`);
  check('Simulacao devolve total de 50,00', quote.data?.total === 5000, `total ${money(quote.data?.total ?? 0)}`);

  const saleList = await api('/api/sales?perPage=5', { token });
  check('Listagem de vendas funciona', saleList.status === 200 && saleList.data?.data?.length > 0);

  const saleDetail = await api(`/api/sales/${sale.data?.sale?.id}`, { token });
  check('Detalhe da venda traz os itens', saleDetail.data?.items?.length === 1, `${saleDetail.data?.items?.length} itens`);
  check('Item traz snapshot do nome do produto', typeof saleDetail.data?.items?.[0]?.productName === 'string');

  /* -------------------------------------------------------------- */
  section('10. Cancelamento de venda e estorno');
  const cancel = await api(`/api/sales/${sale.data?.sale?.id}/cancel`, {
    method: 'POST',
    token,
    body: { reason: 'Erro de digitacao do vendedor', restock: true },
  });
  check('Cancelamento de venda aceito', cancel.status === 200, JSON.stringify(cancel.data?.error));

  const productAfterCancel = (await api(`/api/products/${productId}`, { token })).data;
  check('Estoque devolvido apos cancelamento (297 -> 300)', productAfterCancel?.stock === 300, `estoque ${productAfterCancel?.stock}`);

  const canceledSale = await api(`/api/sales/${sale.data?.sale?.id}`, { token });
  check('Venda marcada como CANCELADA', canceledSale.data?.status === 'CANCELADA', canceledSale.data?.status);
  check('Motivo do cancelamento registrado', typeof canceledSale.data?.cancelReason === 'string');

  const doubleCancel = await api(`/api/sales/${sale.data?.sale?.id}/cancel`, {
    method: 'POST',
    token,
    body: { reason: 'Tentativa duplicada' },
  });
  check('Cancelar duas vezes e bloqueado', doubleCancel.status === 409, `status ${doubleCancel.status}`);

  /* -------------------------------------------------------------- */
  section('11. Fechamento de caixa');
  const cashDetail = await api(`/api/cash/sessions/${cashSessionId}`, { token });
  check('Detalhe do caixa lista movimentacoes', cashDetail.status === 200 && Array.isArray(cashDetail.data?.movements));
  check('Estorno da venda cancelada registrado', cashDetail.data?.movements?.some((m) => m.kind === 'ESTORNO'));

  const close = await api('/api/cash/close', {
    method: 'POST',
    token,
    body: { reportedAmountCents: 10000, notes: 'Conferencia de teste' },
  });
  check('Fechamento de caixa aceito', close.status === 200, JSON.stringify(close.data?.error));
  check(
    'Valor esperado = inicial + entradas - saidas',
    close.data?.summary?.expectedAmountCents === 10000,
    `esperado ${money(close.data?.summary?.expectedAmountCents ?? 0)}`,
  );
  check('Diferenca calculada', close.data?.summary?.differenceCents === 0, `diferenca ${close.data?.summary?.differenceCents}`);
  check('Fechamento dentro da tolerancia', close.data?.summary?.withinTolerance === true);

  const cashAfterClose = await api('/api/cash/current', { token });
  check('Nenhum caixa aberto apos o fechamento', cashAfterClose.data?.session === null);

  /* -------------------------------------------------------------- */
  section('12. Dashboard e relatorios com dados reais');
  for (const range of ['HOJE', 'ULTIMOS_7', 'ULTIMOS_30', 'MES_ATUAL']) {
    const dash = await api(`/api/dashboard?range=${range}`, { token });
    check(`Dashboard range=${range} responde 200`, dash.status === 200, JSON.stringify(dash.data?.error));
    check(`Dashboard range=${range} traz KPI com numeros`, typeof dash.data?.kpi?.revenueCents === 'number');
  }

  const dash7 = await api('/api/dashboard?range=ULTIMOS_7', { token });
  check('Serie diaria preenchida', Array.isArray(dash7.data?.series?.daily) && dash7.data.series.daily.length === 7, `${dash7.data?.series?.daily?.length} dias`);
  check('Produtos mais vendidos vem do banco', Array.isArray(dash7.data?.series?.topProducts));

  const reports = await api('/api/reports/available', { token });
  check('Lista de relatorios disponiveis', reports.data?.data?.length >= 8, `${reports.data?.data?.length} relatorios`);

  for (const key of ['vendas', 'produtos', 'estoque', 'vendedores', 'mais-vendidos']) {
    const rep = await api(`/api/reports/${key}`, { token });
    check(`Relatorio ${key} gera resultado`, rep.status === 200, `status ${rep.status}`);
  }

  const csv = await api('/api/reports/produtos?format=csv', { token });
  check('Exportacao CSV funciona', csv.status === 200 && String(csv.data?.raw ?? '').includes(';'), `status ${csv.status}`);

  /* -------------------------------------------------------------- */
  section('13. Auditoria');
  const audit = await api('/api/audit?perPage=100', { token });
  check('Logs de auditoria listados', audit.status === 200 && audit.data?.data?.length > 0, `${audit.data?.data?.length} registros`);
  const descriptions = (audit.data?.data ?? []).map((l) => l.description).join(' | ');
  check('Auditoria registra venda realizada', /realizou a venda #\d+/.test(descriptions), descriptions.slice(0, 120));
  check('Auditoria registra cancelamento', /cancelou a venda #\d+/.test(descriptions));
  check('Auditoria registra ajuste de estoque', /alterou o estoque|Estoque inicial|ajuste/i.test(descriptions));
  check('Auditoria registra login', /entrou no sistema/.test(descriptions));
  const leak = (audit.data?.data ?? []).filter((l) => JSON.stringify(l).toLowerCase().includes('passwordhash'));
  check('Auditoria nunca guarda hash de senha', leak.length === 0, `${leak.length} vazamentos`);

  /* -------------------------------------------------------------- */
  section('14. Permissoes do vendedor');
  const sellerName = `vendedor_${Date.now().toString().slice(-8)}`;
  const newSeller = await api('/api/users', {
    method: 'POST',
    token,
    body: {
      name: 'Vendedor Teste',
      username: sellerName,
      email: `${sellerName}@webdistribuidora.com.br`,
      password: 'Senha12345',
      role: 'VENDEDOR',
    },
  });
  check('Administrador cria vendedor', newSeller.status === 201, JSON.stringify(newSeller.data?.error));

  const weakPassword = await api('/api/users', {
    method: 'POST',
    token,
    body: {
      name: 'Senha Fraca',
      username: `fraco_${Date.now().toString().slice(-8)}`,
      email: `fraco_${Date.now().toString().slice(-8)}@x.com`,
      password: 'abc',
      role: 'VENDEDOR',
    },
  });
  check('Senha curta e rejeitada', weakPassword.status === 422, `status ${weakPassword.status}`);

  const sellerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: sellerName, password: 'Senha12345' },
  });
  check('Vendedor consegue entrar', sellerLogin.status === 200, JSON.stringify(sellerLogin.data?.error));
  const sellerToken = sellerLogin.data?.tokens?.accessToken;
  check('Vendedor recebe perfil VENDEDOR', sellerLogin.data?.user?.role === 'VENDEDOR');

  const sellerUsers = await api('/api/users', { token: sellerToken });
  check('Vendedor NAO acessa gestao de usuarios (403)', sellerUsers.status === 403, `status ${sellerUsers.status}`);

  const sellerCreate = await api('/api/products', {
    method: 'POST',
    token: sellerToken,
    body: { name: 'Produto indevido', costPrice: '1,00', salePrice: '2,00' },
  });
  check('Vendedor NAO cadastra produtos (403)', sellerCreate.status === 403, `status ${sellerCreate.status}`);

  const sellerDiscount = await api('/api/sales', {
    method: 'POST',
    token: sellerToken,
    body: {
      items: [{ productId, quantity: 1, discountPercent: 50 }],
      paymentMethod: 'DINHEIRO',
    },
  });
  check('Vendedor tem desconto bloqueado (403)', sellerDiscount.status === 403, `status ${sellerDiscount.status}`);
  check('Mensagem de desconto e clara', /desconto/i.test(sellerDiscount.data?.error?.message ?? ''), sellerDiscount.data?.error?.message);

  const sellerReadProducts = await api('/api/products?perPage=1', { token: sellerToken });
  check('Vendedor PODE consultar produtos', sellerReadProducts.status === 200, `status ${sellerReadProducts.status}`);

  const sellerDashboard = await api('/api/dashboard?range=HOJE', { token: sellerToken });
  check('Vendedor PODE ver o dashboard', sellerDashboard.status === 200, `status ${sellerDashboard.status}`);

  const sellerSettings = await api('/api/settings', { token: sellerToken });
  check('Vendedor NAO acessa configuracoes (403)', sellerSettings.status === 403, `status ${sellerSettings.status}`);

  const sellerCashExit = await api('/api/cash/exits', {
    method: 'POST',
    token: sellerToken,
    body: { kind: 'SANGRIA', amountCents: 1000, description: 'Tentativa indevida' },
  });
  check('Vendedor NAO registra sangria', sellerCashExit.status !== 201, `status ${sellerCashExit.status}`);

  const block = await api(`/api/users/${newSeller.data?.id}/status`, {
    method: 'POST',
    token,
    body: { status: 'BLOQUEADO' },
  });
  check('Administrador bloqueia vendedor', block.status === 200 && block.data?.status === 'BLOQUEADO');

  const blockedLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { username: sellerName, password: 'Senha12345' },
  });
  check('Vendedor bloqueado NAO consegue entrar', blockedLogin.status === 403, `status ${blockedLogin.status}`);

  const blockedWithToken = await api('/api/products?perPage=1', { token: sellerToken });
  check(
    'Token do bloqueado perde o acesso imediatamente',
    blockedWithToken.status === 403,
    `status ${blockedWithToken.status}`,
  );

  /* -------------------------------------------------------------- */
  section('15. Logout e limpeza');
  const logout = await api('/api/auth/logout', { method: 'POST', token, body: { refreshToken: newRefresh } });
  check('Logout retorna 200', logout.status === 200, `status ${logout.status}`);

  const afterLogout = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: newRefresh } });
  check('Token de renovacao invalido apos logout', afterLogout.status === 401, `status ${afterLogout.status}`);

  const deactivate = await api(`/api/products/${productId}/status`, {
    method: 'POST',
    token,
    body: { status: 'INATIVO' },
  });
  check('Produto de teste desativado para limpeza', deactivate.status === 200);

  /* -------------------------------------------------------------- */
  console.log(`\n${c.bold('==============================================================')}`);
  console.log(c.bold(' RESULTADO'));
  console.log(`${c.bold('==============================================================')}`);
  console.log(`  ${c.green('Passou:')} ${passed}`);
  console.log(`  ${failed > 0 ? c.red('Falhou:') : 'Falhou:'} ${failed}`);
  if (failures.length > 0) {
    console.log(`\n${c.red('Falhas:')}`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nErro inesperado no teste: ${err?.stack ?? err}\n`));
  process.exit(2);
});
