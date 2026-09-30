import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { reportQuerySchema, reportColumnLabels } from '@webdist/shared';
import { resolveRangeLocal, centsToBRL } from './report-helpers.js';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../../lib/audit.js';
import { toCsv } from '../../lib/csv.js';
import type { AuthUser } from '../../plugins/auth.js';

type ReportKey =
  | 'vendas'
  | 'produtos'
  | 'estoque'
  | 'movimentacao'
  | 'caixa'
  | 'vendedores'
  | 'faturamento'
  | 'mais-vendidos'
  | 'produtos-parados';

const REPORT_LABELS: Record<ReportKey, string> = {
  vendas: 'Relatorio de vendas',
  produtos: 'Relatorio de produtos',
  estoque: 'Relatorio de estoque',
  movimentacao: 'Relatorio de movimentacoes',
  caixa: 'Relatorio de caixa',
  vendedores: 'Relatorio de vendedores',
  faturamento: 'Relatorio de faturamento',
  'mais-vendidos': 'Produtos mais vendidos',
  'produtos-parados': 'Produtos sem saida',
};

interface ReportResult {
  columns: string[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

function defaultRange(query: { from?: Date; to?: Date }) {
  return resolveRangeLocal(query.from, query.to);
}

async function buildSalesReport(
  from: Date,
  to: Date,
  sellerId: number | undefined,
  limit: number,
): Promise<ReportResult> {
  const sales = await prisma.sale.findMany({
    where: {
      status: 'CONCLUIDA',
      ...(sellerId ? { sellerId } : {}),
      createdAt: { gte: from, lte: to },
    },
    include: {
      seller: { select: { name: true } },
      user: { select: { name: true } },
      customer: { select: { name: true } },
      items: { select: { quantity: true, productName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const rows = sales.map((s) => ({
    venda: s.number,
    data: s.createdAt.toLocaleString('pt-BR'),
    vendedor: s.seller?.name ?? '',
    operador: s.user?.name ?? '',
    cliente: s.customer?.name ?? '',
    forma_pagamento: s.paymentMethod,
    itens: s.items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: centsToBRL(s.subtotal),
    desconto: centsToBRL(s.discountCents),
    total: centsToBRL(s.total),
    lucro_estimado: centsToBRL(s.total - s.costTotal),
    status: s.status,
  }));

  const total = sales.reduce((sum, s) => sum + s.total, 0);
  const cost = sales.reduce((sum, s) => sum + s.costTotal, 0);

  return {
    columns: [
      'venda',
      'data',
      'vendedor',
      'operador',
      'cliente',
      'forma_pagamento',
      'itens',
      'subtotal',
      'desconto',
      'total',
      'lucro_estimado',
      'status',
    ],
    rows,
    summary: {
      total_vendas: sales.length,
      faturamento: centsToBRL(total),
      lucro_estimado: centsToBRL(total - cost),
      ticket_medio: centsToBRL(sales.length ? Math.round(total / sales.length) : 0),
    },
  };
}

async function buildProductsReport(): Promise<ReportResult> {
  const products = await prisma.product.findMany({
    include: { category: { select: { name: true } }, brand: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  return {
    columns: [
      'codigo_interno',
      'codigo_barras',
      'nome',
      'categoria',
      'marca',
      'fornecedor',
      'custo',
      'preco_venda',
      'margem_percent',
      'estoque',
      'estoque_minimo',
      'unidade',
      'status',
    ],
    rows: products.map((p) => ({
      codigo_interno: p.internalCode ?? '',
      codigo_barras: p.barcode ?? '',
      nome: p.name,
      categoria: p.category?.name ?? '',
      marca: p.brand?.name ?? '',
      fornecedor: p.supplier?.name ?? '',
      custo: centsToBRL(p.costPrice),
      preco_venda: centsToBRL(p.salePrice),
      margem_percent:
        p.salePrice > 0 ? (((p.salePrice - p.costPrice) / p.salePrice) * 100).toFixed(2).replace('.', ',') : '0,00',
      estoque: p.stock,
      estoque_minimo: p.minStock,
      unidade: p.unit,
      status: p.status,
    })),
    summary: { total_produtos: products.length },
  };
}

async function buildStockReport(): Promise<ReportResult> {
  const products = await prisma.product.findMany({
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  return {
    columns: ['codigo_interno', 'nome', 'categoria', 'estoque', 'estoque_minimo', 'unidade', 'valor_custo', 'valor_venda', 'situacao'],
    rows: products.map((p) => {
      const situacao = p.stock <= 0 ? 'ZERADO' : p.minStock > 0 && p.stock <= p.minStock ? 'CRITICO' : p.minStock > 0 && p.stock <= p.minStock * 1.25 ? 'BAIXO' : 'OK';
      return {
        codigo_interno: p.internalCode ?? '',
        nome: p.name,
        categoria: p.category?.name ?? '',
        estoque: p.stock,
        estoque_minimo: p.minStock,
        unidade: p.unit,
        valor_custo: centsToBRL(p.stock * p.costPrice),
        valor_venda: centsToBRL(p.stock * p.salePrice),
        situacao,
      };
    }),
    summary: {
      total_produtos: products.length,
      zerados: products.filter((p) => p.stock <= 0).length,
      valor_estoque_custo: centsToBRL(products.reduce((s, p) => s + p.stock * p.costPrice, 0)),
      valor_estoque_venda: centsToBRL(products.reduce((s, p) => s + p.stock * p.salePrice, 0)),
    },
  };
}

async function buildMovementReport(from: Date, to: Date, limit: number): Promise<ReportResult> {
  const movements = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: { product: { select: { name: true, unit: true } }, user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return {
    columns: ['data', 'tipo', 'produto', 'quantidade', 'unidade', 'estoque_anterior', 'estoque_posterior', 'motivo', 'documento', 'responsavel'],
    rows: movements.map((m) => ({
      data: m.createdAt.toLocaleString('pt-BR'),
      tipo: m.type,
      produto: m.product?.name ?? '',
      quantidade: m.quantity,
      unidade: m.product?.unit ?? 'UN',
      estoque_anterior: m.previousStock,
      estoque_posterior: m.resultingStock,
      motivo: m.reason,
      documento: m.documentNumber ?? '',
      responsavel: m.user?.name ?? '',
    })),
    summary: { total_movimentacoes: movements.length },
  };
}

async function buildCashReport(from: Date, to: Date, limit: number): Promise<ReportResult> {
  const sessions = await prisma.cashSession.findMany({
    where: { openedAt: { gte: from, lte: to } },
    include: { user: { select: { name: true } } },
    orderBy: { openedAt: 'desc' },
    take: limit,
  });

  const ids = sessions.map((s) => s.id);
  const grouped = await prisma.cashMovement.groupBy({
    by: ['cashSessionId', 'type'],
    where: { cashSessionId: { in: ids } },
    _sum: { amountCents: true },
  });

  const sumFor = (sessionId: number, type: 'ENTRADA' | 'SAIDA') =>
    grouped.find((g) => g.cashSessionId === sessionId && g.type === type)?._sum.amountCents ?? 0;

  return {
    columns: ['abertura', 'responsavel', 'status', 'valor_inicial', 'entradas', 'saidas', 'esperado', 'informado', 'diferenca'],
    rows: sessions.map((s) => {
      const entries = sumFor(s.id, 'ENTRADA');
      const exits = sumFor(s.id, 'SAIDA');
      return {
        abertura: s.openedAt.toLocaleString('pt-BR'),
        responsavel: s.user?.name ?? '',
        status: s.status,
        valor_inicial: centsToBRL(s.initialAmountCents),
        entradas: centsToBRL(entries),
        saidas: centsToBRL(exits),
        esperado: centsToBRL(s.initialAmountCents + entries - exits),
        informado: s.reportedAmountCents === null ? '' : centsToBRL(s.reportedAmountCents),
        diferenca: s.differenceCents === null ? '' : centsToBRL(s.differenceCents),
      };
    }),
    summary: { total_sessoes: sessions.length },
  };
}

async function buildSellerReport(from: Date, to: Date): Promise<ReportResult> {
  const grouped = await prisma.sale.groupBy({
    by: ['sellerId'],
    where: { status: 'CONCLUIDA', createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    _sum: { total: true, costTotal: true, discountCents: true },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.sellerId) } },
    select: { id: true, name: true, username: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return {
    columns: ['vendedor', 'usuario', 'vendas', 'faturamento', 'lucro_estimado', 'descontos', 'ticket_medio'],
    rows: grouped
      .map((g) => {
        const count = g._count._all;
        const revenue = g._sum.total ?? 0;
        return {
          vendedor: byId.get(g.sellerId)?.name ?? `Vendedor #${g.sellerId}`,
          usuario: byId.get(g.sellerId)?.username ?? '',
          vendas: count,
          faturamento: centsToBRL(revenue),
          lucro_estimado: centsToBRL(revenue - (g._sum.costTotal ?? 0)),
          descontos: centsToBRL(g._sum.discountCents ?? 0),
          ticket_medio: centsToBRL(count ? Math.round(revenue / count) : 0),
        };
      })
      .sort((a, b) => b.faturamento.localeCompare(a.faturamento, 'pt-BR')),
    summary: {
      total_vendedores: grouped.length,
      faturamento_total: centsToBRL(grouped.reduce((s, g) => s + (g._sum.total ?? 0), 0)),
    },
  };
}

async function buildTopProductsReport(from: Date, to: Date, limit: number): Promise<ReportResult> {
  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { status: 'CONCLUIDA', createdAt: { gte: from, lte: to } } },
    _sum: { quantity: true, subtotal: true, costPrice: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, name: true, internalCode: true, unit: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return {
    columns: ['posicao', 'codigo_interno', 'produto', 'unidade', 'quantidade_vendida', 'faturamento', 'lucro_estimado'],
    rows: grouped.map((g, index) => {
      const revenue = g._sum.subtotal ?? 0;
      const cost = (g._sum.costPrice ?? 0) * (g._sum.quantity ?? 0);
      return {
        posicao: index + 1,
        codigo_interno: byId.get(g.productId)?.internalCode ?? '',
        produto: byId.get(g.productId)?.name ?? `Produto #${g.productId}`,
        unidade: byId.get(g.productId)?.unit ?? 'UN',
        quantidade_vendida: g._sum.quantity ?? 0,
        faturamento: centsToBRL(revenue),
        lucro_estimado: centsToBRL(revenue - cost),
      };
    }),
    summary: { total_itens: grouped.reduce((s, g) => s + (g._sum.quantity ?? 0), 0) },
  };
}

async function buildIdleProductsReport(months: number): Promise<ReportResult> {
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { status: 'CONCLUIDA', createdAt: { gte: since } } },
    _sum: { quantity: true },
  });

  const soldIds = new Set(grouped.map((g) => g.productId));

  const products = await prisma.product.findMany({
    where: { status: 'ATIVO', id: { notIn: [...soldIds] } },
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  return {
    columns: ['codigo_interno', 'nome', 'categoria', 'estoque', 'unidade', 'valor_estoque', 'dias_sem_saida'],
    rows: products.map((p) => ({
      codigo_interno: p.internalCode ?? '',
      nome: p.name,
      categoria: p.category?.name ?? '',
      estoque: p.stock,
      unidade: p.unit,
      valor_estoque: centsToBRL(p.stock * p.costPrice),
      dias_sem_saida: months * 30,
    })),
    summary: {
      meses_analisados: months,
      produtos_parados: products.length,
      valor_preso: centsToBRL(products.reduce((s, p) => s + p.stock * p.costPrice, 0)),
    },
  };
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/available', { preHandler: [app.requirePermission('reports:read')] }, async () => ({
    data: Object.entries(REPORT_LABELS).map(([key, label]) => ({ key, label })),
  }));

  app.get('/:key', { preHandler: [app.requirePermission('reports:read')] }, async (request, reply) => {
    const actor = request.currentUser as AuthUser;
    const { key } = z.object({ key: z.string().min(1).max(40) }).parse(request.params);
    const query = reportQuerySchema.parse(request.query ?? {});

    if (!(key in REPORT_LABELS)) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Relatorio nao encontrado.', requestId: request.id },
      });
    }

    const { from, to } = defaultRange(query);
    const limit = query.perPage * query.page > 0 ? 10000 : 10000;

    let result: ReportResult;
    switch (key as ReportKey) {
      case 'vendas':
        result = await buildSalesReport(from, to, query.sellerId, limit);
        break;
      case 'produtos':
        result = await buildProductsReport();
        break;
      case 'estoque':
        result = await buildStockReport();
        break;
      case 'movimentacao':
        result = await buildMovementReport(from, to, limit);
        break;
      case 'caixa':
        result = await buildCashReport(from, to, limit);
        break;
      case 'vendedores':
        result = await buildSellerReport(from, to);
        break;
      case 'faturamento':
        result = await buildSalesReport(from, to, query.sellerId, limit);
        break;
      case 'mais-vendidos':
        result = await buildTopProductsReport(from, to, 100);
        break;
      case 'produtos-parados':
        result = await buildIdleProductsReport(3);
        break;
      default:
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Relatorio nao encontrado.', requestId: request.id },
        });
    }

    const label = REPORT_LABELS[key as ReportKey];

    if (query.format === 'csv') {
      const csv = toCsv(result.columns, result.rows, reportColumnLabels(result.columns));
      await recordAudit({
        userId: actor.id,
        userName: actor.username,
        action: 'EXPORT',
        entity: 'Report',
        description: `${actor.name} exportou "${label}" em CSV (${result.rows.length} linhas)`,
        request,
      });
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${key}-${Date.now()}.csv"`)
        .send(`\uFEFF${csv}`);
    }

    if (query.format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'WEB DISTRIBUIDORA';
      const sheet = workbook.addWorksheet(label.slice(0, 30));

      if (result.summary) {
        sheet.addRow([label]);
        sheet.addRow([]);
        for (const [key2, value] of Object.entries(result.summary)) {
          sheet.addRow([key2, value]);
        }
        sheet.addRow([]);
      }

const columnLabels = reportColumnLabels(result.columns);
      sheet.addRow(columnLabels);
      for (const row of result.rows) {
        sheet.addRow(result.columns.map((c) => row[c] ?? ''));
      }
      sheet.getRow(1).font = { bold: true };
      const headerRow = sheet.getRow(Object.keys(result.summary ?? {}).length + 4);
      headerRow.font = { bold: true };
      sheet.columns.forEach((column, index) => {
        const key = result.columns[index] ?? '';
        const maxLen = Math.max(
          (columnLabels[index] ?? '').length,
          ...result.rows.slice(0, 200).map((r) => String(r[key] ?? '').length),
          10,
        );
        column.width = Math.min(50, maxLen + 2);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      await recordAudit({
        userId: actor.id,
        userName: actor.username,
        action: 'EXPORT',
        entity: 'Report',
        description: `${actor.name} exportou "${label}" em Excel (${result.rows.length} linhas)`,
        request,
      });
      return reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header('Content-Disposition', `attachment; filename="${key}-${Date.now()}.xlsx"`)
        .send(Buffer.from(buffer));
    }

    return {
      key,
      label,
      period: { from: from.toISOString(), to: to.toISOString() },
      columns: result.columns,
      rows: result.rows,
      summary: result.summary,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total: result.rows.length,
        totalPages: 1,
      },
    };
  });
}
