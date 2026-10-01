import { prisma } from '../../lib/prisma.js';
import type { CashForecastPoint, ConfidenceLevel } from '@webdist/shared';

/**
 * PREVISAO DE CAIXA
 *
 * Projecao simples e deliberadamente conservadora: media historica de
 * entradas e saidas, aplicada sobre o saldo real de hoje. Nao usa modelo
 * de series temporais porque, em uma distribuidora com poucos meses de
 * operacao, um modelo treinado em poucos dias produz numeros com
 * aparencia de precisa��ao que nao existe.
 *
 * Quando nao ha historico suficiente, os pontos sao devolvidos com
 * `basis: 'SEM_HISTORICO'` e valores zero, e a interface exibe
 * "Ainda nao existem dados suficientes" em vez de um grafico achatado.
 */

const ANALYSIS_DAYS = 60;
const MIN_DAYS_FOR_FORECAST = 7;

export async function buildCashForecast(days = 14): Promise<{
  currentBalanceCents: number;
  openSessionId: number | null;
  points: CashForecastPoint[];
  averages: { dailyInCents: number; dailyOutCents: number; dailySalesCents: number; daysAnalyzed: number };
  confidence: ConfidenceLevel;
  basis: string;
  generatedAt: string;
}> {
  const since = new Date(Date.now() - ANALYSIS_DAYS * 86_400_000);

  const [movements, salesAgg, openSession] = await Promise.all([
    prisma.cashMovement.findMany({
      where: { createdAt: { gte: since } },
      select: { type: true, amountCents: true, createdAt: true },
    }),
    prisma.sale.aggregate({
      where: { status: 'CONCLUIDA', createdAt: { gte: since } },
      _sum: { total: true },
      _count: { id: true },
    }),
    prisma.cashSession.findFirst({
      where: { status: 'ABERTO' },
      orderBy: { openedAt: 'desc' },
      select: { id: true, initialAmountCents: true },
    }),
  ]);

  // Dias efetivamente com movimento: e o divisor honesto. Dividir sempre
  // por 60 daria uma media artificialmente baixa em uma distribuidora
  // que so vende de segunda a sabado.
  const activeDays = new Set(
    movements.map((m) => m.createdAt.toISOString().slice(0, 10)),
  ).size;

  const inTotal = movements
    .filter((m) => m.type === 'ENTRADA')
    .reduce((s, m) => s + m.amountCents, 0);
  const outTotal = movements
    .filter((m) => m.type === 'SAIDA')
    .reduce((s, m) => s + m.amountCents, 0);

  // Saldo atual: soma das movimentacoes do caixa aberto + fundo inicial.
  // Nao soma historico de sessões ja fechadas, que nao esta no caixa de hoje.
  let currentBalanceCents = openSession?.initialAmountCents ?? 0;
  if (openSession) {
    const openMovements = await prisma.cashMovement.aggregate({
      where: { cashSessionId: openSession.id },
      _sum: { amountCents: true },
    });
    // `amountCents` e sempre positivo; o sinal vem de `type`, entao
    // precisamos separar entradas de saidas explicitamente.
    const grouped = await prisma.cashMovement.groupBy({
      by: ['type'],
      where: { cashSessionId: openSession.id },
      _sum: { amountCents: true },
    });
    for (const row of grouped) {
      const total = row._sum.amountCents ?? 0;
      currentBalanceCents += row.type === 'ENTRADA' ? total : -total;
    }
    void openMovements;
  }

  const hasEnoughData = activeDays >= MIN_DAYS_FOR_FORECAST && (salesAgg._count.id ?? 0) > 0;

  const dailyInCents = activeDays > 0 ? Math.round(inTotal / activeDays) : 0;
  const dailyOutCents = activeDays > 0 ? Math.round(outTotal / activeDays) : 0;
  const dailySalesCents =
    (salesAgg._count.id ?? 0) > 0 && activeDays > 0
      ? Math.round((salesAgg._sum.total ?? 0) / activeDays)
      : 0;

  const points: CashForecastPoint[] = [];
  let running = currentBalanceCents;

  for (let i = 1; i <= days; i += 1) {
    const date = new Date(Date.now() + i * 86_400_000);
    if (hasEnoughData) {
      running += dailyInCents - dailyOutCents;
      points.push({
        date: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        expectedInCents: dailyInCents,
        expectedOutCents: dailyOutCents,
        expectedNetCents: dailyInCents - dailyOutCents,
        projectedBalanceCents: running,
        basis: 'HISTORICO',
      });
    } else {
      points.push({
        date: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        expectedInCents: 0,
        expectedOutCents: 0,
        expectedNetCents: 0,
        projectedBalanceCents: running,
        basis: 'SEM_HISTORICO',
      });
    }
  }

  const confidence: ConfidenceLevel = !hasEnoughData
    ? 'SEM_DADOS'
    : activeDays >= 45
      ? 'ALTA'
      : activeDays >= 21
        ? 'MEDIA'
        : 'BAIXA';

  return {
    currentBalanceCents,
    openSessionId: openSession?.id ?? null,
    points,
    averages: {
      dailyInCents,
      dailyOutCents,
      dailySalesCents,
      daysAnalyzed: activeDays,
    },
    confidence,
    basis: hasEnoughData
      ? `Projecao baseada na media de ${activeDays} dia(s) com movimentacao nos ultimos ${ANALYSIS_DAYS} dias. Projecao nao e garantia de resultado.`
      : `Ainda nao existem dados suficientes: sao necessarios ao menos ${MIN_DAYS_FOR_FORECAST} dias com movimentacao de caixa.`,
    generatedAt: new Date().toISOString(),
  };
}
