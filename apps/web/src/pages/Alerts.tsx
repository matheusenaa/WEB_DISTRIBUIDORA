import { STOCK_ALERT_LABELS, type StockAlertDTO } from '@webdist/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Download, PackageX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { api, downloadFile } from '@/lib/api';
import { integer, qty } from '@/lib/format';

export function AlertsPage() {
  const [level, setLevel] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stock', 'alerts', level],
    queryFn: () =>
      api.get<{ data: StockAlertDTO[]; summary?: Record<string, number> }>('/api/stock/alerts', {
        level: level || undefined,
      }),
  });

  const alerts = data?.data ?? [];

  const grouped = useMemo(
    () => ({
      zerado: alerts.filter((alert) => alert.alertLevel === 'ZERADO'),
      critico: alerts.filter((alert) => alert.alertLevel === 'CRITICO'),
      baixo: alerts.filter((alert) => alert.alertLevel === 'BAIXO'),
    }),
    [alerts],
  );

  // Custo de reposicao: quanto precisa comprar para cobrir o minimo.
  const restockValue = useMemo(
    () => alerts.reduce((sum, alert) => sum + alert.suggestedRestock, 0),
    [alerts],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Boxes className="h-5 w-5 text-accent" aria-hidden />
            Alertas de estoque
          </h1>
          <p className="text-sm text-muted-foreground">
            Produtos que precisam de reposicao para nao perder vendas
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            void downloadFile('/api/reports/estoque', { format: 'csv' }, 'estoque.csv').catch(() =>
              toast.error('Nao foi possivel exportar.'),
            )
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          Exportar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <AlertCard
          label="Estoque zerado"
          count={grouped.zerado.length}
          tone="destructive"
          onClick={() => setLevel(level === 'ZERADO' ? '' : 'ZERADO')}
          active={level === 'ZERADO'}
        />
        <AlertCard
          label="Estoque critico"
          count={grouped.critico.length}
          tone="warning"
          onClick={() => setLevel(level === 'CRITICO' ? '' : 'CRITICO')}
          active={level === 'CRITICO'}
        />
        <AlertCard
          label="Estoque baixo"
          count={grouped.baixo.length}
          tone="muted"
          onClick={() => setLevel(level === 'BAIXO' ? '' : 'BAIXO')}
          active={level === 'BAIXO'}
        />
      </div>

      {level && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span>Filtro ativo: {STOCK_ALERT_LABELS[level as keyof typeof STOCK_ALERT_LABELS]}</span>
          <Button variant="ghost" size="sm" onClick={() => setLevel('')}>
            Limpar
          </Button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Produtos em alerta"
          description={
            alerts.length > 0
              ? `${integer(alerts.length)} produto(s) - ${integer(restockValue)} unidade(s) para repor`
              : 'Nenhum produto precisa de reposicao'
          }
        />
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : alerts.length === 0 ? (
            <EmptyState
              title="Estoque em dia"
              description="Nenhum produto abaixo do estoque minimo no momento."
              icon={<Boxes className="h-8 w-8" aria-hidden />}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th>Produto</th>
                    <th>Codigo</th>
                    <th className="text-right">Estoque</th>
                    <th className="text-right">Minimo</th>
                    <th className="text-right">Repor</th>
                    <th>Situacao</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert) => (
                    <tr key={alert.productId}>
                      <td className="font-medium">{alert.name}</td>
                      <td className="font-mono text-xs text-muted-foreground">
                        {alert.code || '-'}
                      </td>
                      <td className="text-right font-semibold tabular-nums">
                        {qty(alert.stock)} {alert.unit}
                      </td>
                      <td className="text-right tabular-nums text-muted-foreground">
                        {qty(alert.minStock)}
                      </td>
                      <td className="text-right font-semibold tabular-nums text-accent-foreground">
                        {qty(alert.suggestedRestock)}
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
                          {STOCK_ALERT_LABELS[alert.alertLevel]}
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

      {alerts.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          A coluna "Repor" sugere a quantidade necessaria para atingir o dobro do estoque minimo,
          arredondado. Ajuste o valor conforme sua politica de compra.
        </p>
      )}
    </div>
  );
}

function AlertCard({
  label,
  count,
  tone,
  onClick,
  active,
}: {
  label: string;
  count: number;
  tone: 'destructive' | 'warning' | 'muted';
  onClick: () => void;
  active: boolean;
}) {
  const toneClass = {
    destructive: 'border-destructive/40 text-destructive',
    warning: 'border-warning/40 text-warning',
    muted: 'border-border text-muted-foreground',
  }[tone];

  const Icon = tone === 'destructive' ? PackageX : AlertTriangle;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 ${toneClass} ${
        active ? 'ring-2 ring-accent' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums">{integer(count)}</p>
    </button>
  );
}