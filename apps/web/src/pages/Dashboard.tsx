import type { DashboardPayload, DashboardRange } from '@webdist/shared';
import { DASHBOARD_RANGES, DASHBOARD_RANGE_LABELS } from '@webdist/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, DollarSign, Package, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Card, CardContent, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { Select, Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { integer, money, moneyPlain, percent } from '@/lib/format';

export function DashboardPage() {
  const { user, can } = useAuth();
  const [range, setRange] = useState<DashboardRange>('ULTIMOS_7');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });

  const query = useQuery({
    queryKey: ['dashboard', range, custom.from, custom.to],
    queryFn: () =>
      api.get<DashboardPayload>('/api/dashboard', {
        range,
        from: range === 'PERSONALIZADO' ? custom.from || undefined : undefined,
        to: range === 'PERSONALIZADO' ? custom.to || undefined : undefined,
      }),
    enabled: range !== 'PERSONALIZADO' || (custom.from !== '' && custom.to !== ''),
  });

  const data = query.data;
  const kpi = data?.kpi;

  // Comparacao com o periodo anterior, calculada no backend.
  const comparison = useMemo(() => {
    if (!kpi || !data?.comparison) return null;
    const previousRevenue = data.comparison.revenueCents;
    const previousSales = data.comparison.salesCount;
    return {
      revenue:
        previousRevenue > 0 ? ((kpi.revenueCents - previousRevenue) / previousRevenue) * 100 : null,
      sales: previousSales > 0 ? ((kpi.salesCount - previousSales) / previousSales) * 100 : null,
      // Com o periodo ainda correndo (o mes comecado, hoje, ultimos 7 dias),
      // a variacao cai sozinha. O numero continua correto, mas comparar
      // metade do mes com o mes inteiro e mostrar seta vermelha e enganoso.
      partial: data.comparison.partial,
    };
  }, [kpi, data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            Olá, {user?.name.split(' ')[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.range.label ?? 'Carregando...'}
            {!can('sales:read-all') && ' - somente suas vendas'}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Select
              value={range}
              onChange={(event) => setRange(event.target.value as DashboardRange)}
              aria-label="Periodo"
            >
              {DASHBOARD_RANGES.map((option) => (
                <option key={option} value={option}>
                  {DASHBOARD_RANGE_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {range === 'PERSONALIZADO' && (
            <>
              <Input
                type="date"
                value={custom.from}
                onChange={(event) => setCustom((state) => ({ ...state, from: event.target.value }))}
                aria-label="Data inicial"
                className="w-40"
              />
              <Input
                type="date"
                value={custom.to}
                onChange={(event) => setCustom((state) => ({ ...state, to: event.target.value }))}
                aria-label="Data final"
                className="w-40"
              />
            </>
          )}
        </div>
      </div>

      {query.isError && (
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">
              Nao foi possivel carregar o dashboard: {(query.error as Error).message}
            </p>
          </CardContent>
        </Card>
      )}

      {query.isLoading && <Spinner label="Calculando indicadores..." />}

      {kpi && (
        <>
          {/* ---------------- KPIs ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Faturamento"
              value={money(kpi.revenueCents)}
              icon={DollarSign}
              delta={comparison?.revenue}
              tone="primary"
            />
            <KpiCard
              title="Vendas"
              value={integer(kpi.salesCount)}
              icon={Receipt}
              delta={comparison?.sales}
              subtitle={`${integer(kpi.averageSaleItems)} itens por venda (media)`}
            />
            <KpiCard
              title="Ticket medio"
              value={money(kpi.ticketAverageCents)}
              icon={ShoppingCart}
              subtitle={`${integer(kpi.itemsSold)} itens vendidos`}
            />
            <KpiCard
              title="Lucro estimado"
              value={money(kpi.profitCents)}
              icon={TrendingUp}
              subtitle={
                kpi.revenueCents > 0
                  ? `Margem de ${percent(((kpi.profitCents / kpi.revenueCents) * 100))}`
                  : undefined
              }
              tone={kpi.profitCents >= 0 ? 'success' : 'destructive'}
            />
          </div>

          {comparison?.partial && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              O periodo selecionado ainda esta em andamento. A variacao compara com um periodo
              anterior maior no tempo, entao a queda nao indica necessariamente pior desempenho.
            </p>
          )}

          {kpi.canceledCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {integer(kpi.canceledCount)} venda(s) cancelada(s) no periodo. Valores cancelados nao
              entram no faturamento nem no lucro acima.
            </div>
          )}

          {/* ---------------- Graficos ---------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Faturamento por dia"
                description="Receita e lucro estimado no periodo"
              />
              <CardContent className="h-72 pl-0">
                {data!.series.daily.length === 0 ? (
                  <EmptyState title="Sem vendas no periodo" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data!.series.daily} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="profit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                        width={70}
                        tickFormatter={(value: number) => moneyPlain(value)}
                      />
                      <Tooltip
                        content={<ChartTooltip moneyKeys={['revenueCents', 'profitCents']} />}
                        cursor={{ stroke: 'hsl(var(--border))' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        type="monotone"
                        dataKey="revenueCents"
                        name="Faturamento"
                        stroke="hsl(var(--chart-1))"
                        fill="url(#revenue)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="profitCents"
                        name="Lucro"
                        stroke="hsl(var(--chart-3))"
                        fill="url(#profit)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Formas de pagamento" />
              <CardContent className="h-72">
                {data!.series.byPaymentMethod.length === 0 ? (
                  <EmptyState title="Sem dados" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data!.series.byPaymentMethod}
                        dataKey="value"
                        nameKey="label"
                        innerRadius="50%"
                        outerRadius="80%"
                        paddingAngle={2}
                      >
                        {data!.series.byPaymentMethod.map((entry, index) => (
                          <Cell
                            key={entry.id}
                            fill={`hsl(var(--chart-${(index % 5) + 1}))`}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---------------- Top produtos ---------------- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Mais vendidos" description="Por quantidade vendida" />
              <CardContent className="h-72 pl-0">
                {data!.series.topProducts.length === 0 ? (
                  <EmptyState title="Sem vendas no periodo" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data!.series.topProducts.slice(0, 8)}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={130}
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                      <Bar dataKey="value" name="Quantidade" radius={[0, 4, 4, 0]}>
                        {data!.series.topProducts.slice(0, 8).map((entry, index) => (
                          <Cell key={entry.id} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Categorias mais vendidas" description="Por faturamento" />
              <CardContent className="h-72 pl-0">
                {data!.series.byCategory.length === 0 ? (
                  <EmptyState title="Sem dados" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data!.series.byCategory.slice(0, 8)} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickLine={false}
                        axisLine={false}
                        width={70}
                        tickFormatter={(value: number) => moneyPlain(value)}
                      />
                      <Tooltip content={<ChartTooltip moneyKeys={['value']} />} cursor={{ fill: 'hsl(var(--muted))' }} />
                      <Bar dataKey="value" name="Faturamento" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ---------------- Estoque ---------------- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Estoque em alerta"
                description="Produtos que precisam de reposicao"
                action={
                  <Badge tone={data!.stock.outOfStock > 0 ? 'destructive' : 'muted'}>
                    {integer(data!.stock.outOfStock)} zerados
                  </Badge>
                }
              />
              <CardContent className="p-0">
                {data!.stock.alerts.length === 0 ? (
                  <EmptyState
                    title="Nenhum alerta de estoque"
                    description="Todos os produtos estao acima do estoque minimo."
                    icon={<Boxes className="h-8 w-8" aria-hidden />}
                  />
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="table-compact w-full">
                      <thead className="sticky top-0 bg-muted/95">
                        <tr>
                          <th>Produto</th>
                          <th className="text-right">Estoque</th>
                          <th className="text-right">Minimo</th>
                          <th className="text-right">Repor</th>
                          <th>Situacao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.stock.alerts.map((alert) => (
                          <tr key={alert.productId}>
                            <td className="font-medium">{alert.name}</td>
                            <td className="text-right tabular-nums">{integer(alert.stock)}</td>
                            <td className="text-right tabular-nums text-muted-foreground">
                              {integer(alert.minStock)}
                            </td>
                            <td className="text-right font-semibold tabular-nums">
                              {integer(alert.suggestedRestock)}
                            </td>
                            <td>
                              <Badge
                                tone={
                                  alert.alertLevel === 'ZERADO'
                                    ? 'destructive'
                                    : alert.alertLevel === 'CRITICO'
                                      ? 'warning'
                                      : 'muted'
                                }
                              >
                                {alert.alertLevel === 'ZERADO'
                                  ? 'Zerado'
                                  : alert.alertLevel === 'CRITICO'
                                    ? 'Critico'
                                    : 'Baixo'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardContent className="space-y-3 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Valor em estoque
                  </h3>
                  <div>
                    <p className="text-xs text-muted-foreground">Investido (custo)</p>
                    <p className="text-xl font-bold tabular-nums">{money(data!.stock.stockValueCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Valor de venda</p>
                    <p className="text-xl font-bold tabular-nums text-success">
                      {money(data!.stock.retailValueCents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Lucro potencial</p>
                    <p className="text-xl font-bold tabular-nums text-accent-foreground">
                      {money(data!.stock.retailValueCents - data!.stock.stockValueCents)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-2 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Package className="h-4 w-4" aria-hidden />
                    Resumo do catalogo
                  </h3>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Produtos cadastrados</dt>
                      <dd className="font-semibold tabular-nums">{integer(data!.stock.totalProducts)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Estoque zerado</dt>
                      <dd className="font-semibold tabular-nums text-destructive">
                        {integer(data!.stock.outOfStock)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Estoque baixo</dt>
                      <dd className="font-semibold tabular-nums text-warning">
                        {integer(data!.stock.lowStock)}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {can('sales:read-all') && data!.series.bySeller.length > 0 && (
                <Card>
                  <CardHeader title="Vendas por vendedor" />
                  <CardContent className="space-y-2 p-4">
                    {data!.series.bySeller.slice(0, 6).map((seller) => (
                      <div key={seller.id} className="flex items-center justify-between text-sm">
                        <span className="truncate">{seller.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {money(seller.value)} · {integer(seller.count ?? 0)} vendas
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- KPI ---------------- */

function KpiCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  tone = 'default',
}: {
  title: string;
  value: string;
  icon: typeof DollarSign;
  delta?: number | null;
  subtitle?: string;
  tone?: 'default' | 'primary' | 'success' | 'destructive';
}) {
  const toneClass = {
    default: 'text-muted-foreground',
    primary: 'text-primary',
    success: 'text-success',
    destructive: 'text-destructive',
  }[tone];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <p className="mt-1 truncate text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <Icon className={cn('h-5 w-5 shrink-0', toneClass)} aria-hidden />
        </div>
        {(delta !== undefined && delta !== null) || subtitle ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            {delta !== undefined && delta !== null && (
              <span
                className={cn(
                  'flex items-center gap-0.5 font-semibold',
                  delta >= 0 ? 'text-success' : 'text-destructive',
                )}
              >
                {delta >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
                )}
                {percent(Math.abs(delta))}
              </span>
            )}
            {subtitle && <span className="truncate text-muted-foreground">{subtitle}</span>}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ---------------- Tooltip dos graficos ---------------- */

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  moneyKeys = [],
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  moneyKeys?: string[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg">
      {label !== undefined && (
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums">
              {moneyKeys.includes(String(entry.dataKey))
                ? money(Number(entry.value))
                : integer(Number(entry.value))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}