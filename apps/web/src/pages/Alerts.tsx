import {
  STOCK_ALERT_LABELS,
  type StockAlertDTO,
  type StockAlertLevel,
  type StockAlertsReport,
} from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Download,
  PackageX,
  ShoppingCart,
  TrendingDown,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  type Column,
} from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { integer, money, qty } from '@/lib/format';

/**
 * ALERTAS DE ESTOQUE E RECOMPRA
 *
 * A tela fecha o ciclo entre "o que esta acabando" e "o que comprar":
 * os alertas sao agrupados por fornecedor porque e assim que a compra
 * acontece de verdade - um pedido por fornecedor, nao um pedido gigante
 * que ninguem consegue cotar.
 *
 * A coluna "Cobertura" usa o ritmo de venda real dos ultimos 30 dias. Sem
 * historico de venda ela mostra "-" em vez de um numero inventado: um
 * produto que nunca vendeu nao tem previsao de ruptura.
 */

const LEVEL_TONE: Record<StockAlertLevel, 'destructive' | 'warning' | 'muted'> = {
  ZERADO: 'destructive',
  CRITICO: 'warning',
  BAIXO: 'muted',
};

export function AlertsPage() {
  const { can } = useAuth();
  const [level, setLevel] = useState('');
  const [restockOpen, setRestockOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['stock', 'alerts', level],
    queryFn: () =>
      api.get<StockAlertsReport>('/api/stock/alerts', { level: level || undefined }),
    staleTime: 60_000,
  });

  const alerts = data?.data ?? [];
  const summary = data?.summary;
  const groups = data?.groups ?? [];

  const selected = useMemo(
    () => alerts.filter((alert) => alert.suggestedRestock > 0),
    [alerts],
  );

  const columns = useMemo<Column<StockAlertDTO>[]>(
    () => [
      {
        key: 'name',
        header: 'Produto',
        render: (row) => (
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{row.code}</span>
              {row.supplierName && <> · {row.supplierName}</>}
            </p>
          </div>
        ),
      },
      {
        key: 'stock',
        header: 'Estoque',
        className: 'w-24 text-right',
        render: (row) => (
          <span className="font-semibold tabular-nums">
            {qty(row.stock)} <span className="text-xs font-normal text-muted-foreground">{row.unit}</span>
          </span>
        ),
      },
      {
        key: 'minStock',
        header: 'Minimo',
        className: 'w-20 text-right',
        render: (row) => <span className="tabular-nums text-muted-foreground">{qty(row.minStock)}</span>,
      },
      {
        key: 'coverage',
        header: 'Cobertura',
        className: 'w-28 text-right',
        // Baseado no ritmo de venda dos ultimos 30 dias. Sem historico,
        // mostrar "-" em vez de 0 evita leitura de "quebra hoje".
        render: (row) =>
          row.daysOfCoverage === null ? (
            <span className="text-xs text-muted-foreground" title="Sem vendas nos ultimos 30 dias">
              sem dados
            </span>
          ) : (
            <span
              className={cn(
                'tabular-nums',
                row.daysOfCoverage <= 3 && 'font-semibold text-destructive',
              )}
            >
              {qty(row.daysOfCoverage)} d
            </span>
          ),
      },
      {
        key: 'restock',
        header: 'Repor',
        className: 'w-20 text-right',
        render: (row) => (
          <span className="font-semibold tabular-nums text-accent-foreground">
            {qty(row.suggestedRestock)}
          </span>
        ),
      },
      {
        key: 'cost',
        header: 'Custo est.',
        className: 'w-28 text-right',
        render: (row) =>
          row.estimatedCostCents === null ? (
            <span className="text-xs text-muted-foreground" title="Produto sem custo cadastrado">
              sem custo
            </span>
          ) : (
            <span className="tabular-nums">{money(row.estimatedCostCents)}</span>
          ),
      },
      {
        key: 'level',
        header: 'Situacao',
        className: 'w-32',
        render: (row) => <Badge tone={LEVEL_TONE[row.alertLevel]}>{STOCK_ALERT_LABELS[row.alertLevel]}</Badge>,
      },
    ],
    [],
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
        {can('purchases:create') && (
          <Button
            variant="outline"
            onClick={() => setRestockOpen(true)}
            disabled={selected.length === 0}
          >
            <ShoppingCart className="h-4 w-4" aria-hidden />
            Gerar pedido de compra
          </Button>
        )}
        {can('reports:read') && (
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
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <AlertCard
          label="Estoque zerado"
          count={summary?.byLevel.ZERADO ?? 0}
          tone="destructive"
          icon={<PackageX className="h-4 w-4" aria-hidden />}
          onClick={() => setLevel(level === 'ZERADO' ? '' : 'ZERADO')}
          active={level === 'ZERADO'}
        />
        <AlertCard
          label="Estoque critico"
          count={summary?.byLevel.CRITICO ?? 0}
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          onClick={() => setLevel(level === 'CRITICO' ? '' : 'CRITICO')}
          active={level === 'CRITICO'}
        />
        <AlertCard
          label="Estoque baixo"
          count={summary?.byLevel.BAIXO ?? 0}
          tone="muted"
          icon={<TrendingDown className="h-4 w-4" aria-hidden />}
          onClick={() => setLevel(level === 'BAIXO' ? '' : 'BAIXO')}
          active={level === 'BAIXO'}
        />
      </div>

      {summary && summary.byLevel.ZERADO + summary.byLevel.CRITICO + summary.byLevel.BAIXO === 0 && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="text-success">
              <Boxes className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm">
              Nenhum produto abaixo do estoque minimo. Todos os alertas estao resolvidos.
            </p>
          </CardContent>
        </Card>
      )}

      {level && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span>Filtro ativo: {STOCK_ALERT_LABELS[level as StockAlertLevel]}</span>
          <Button variant="ghost" size="sm" onClick={() => setLevel('')}>
            Limpar
          </Button>
        </div>
      )}

      <Card>
        <CardHeader
          title="Produtos em alerta"
          description={
            summary
              ? `${integer(summary.byLevel.ZERADO + summary.byLevel.CRITICO + summary.byLevel.BAIXO)} produto(s) - ${integer(
                  summary.totalUnitsToRestock,
                )} unidade(s) para repor${
                  summary.estimatedTotalCents !== null
                    ? ` - custo estimado ${money(summary.estimatedTotalCents)}`
                    : ` - ${integer(summary.productsWithoutCost)} sem custo cadastrado`
                }`
              : undefined
          }
        />
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={alerts}
            getRowKey={(row) => row.productId}
            loading={isLoading}
            emptyState={
              <EmptyState
                title="Estoque em dia"
                description="Nenhum produto abaixo do estoque minimo no momento."
                icon={<Boxes className="h-8 w-8" aria-hidden />}
              />
            }
          />
        </CardContent>
      </Card>

      {groups.length > 0 && (
        <Card>
          <CardHeader
            title="Recompra por fornecedor"
            description="Um pedido por fornecedor. Selecione os itens que quer comprar."
          />
          <CardContent className="space-y-3 p-4">
            {groups.map((group) => (
              <GroupRow key={group.supplierId ?? 'sem-fornecedor'} group={group} />
            ))}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              A coluna &quot;Repor&quot; sugere a quantidade necessaria para atingir o estoque maximo
              (ou o dobro do minimo, quando nao ha maximo definido). &quot;Cobertura&quot; usa o
              ritmo de venda dos ultimos 30 dias e fica sem dados quando o produto nao vendeu no
              periodo. Ajuste os valores conforme sua politica de compra.
            </p>
          </CardContent>
        </Card>
      )}

      {can('purchases:create') && (
        <RestockModal
          open={restockOpen}
          onClose={() => setRestockOpen(false)}
          groups={groups}
          alerts={alerts}
        />
      )}
    </div>
  );
}

/* ---------------- Card de nivel ---------------- */

function AlertCard({
  label,
  count,
  tone,
  icon,
  onClick,
  active,
}: {
  label: string;
  count: number;
  tone: 'destructive' | 'warning' | 'muted';
  icon: ReactNode;
  onClick: () => void;
  active: boolean;
}) {
  const toneClass = {
    destructive: 'border-destructive/40 text-destructive',
    warning: 'border-warning/40 text-warning',
    muted: 'border-border text-muted-foreground',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50',
        toneClass,
        active && 'ring-2 ring-accent',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className="mt-1 text-3xl font-bold tabular-nums">{integer(count)}</p>
    </button>
  );
}

/* ---------------- Linha por fornecedor ---------------- */

function GroupRow({ group }: { group: StockAlertsReport['groups'][number] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{group.supplierName}</p>
        <p className="text-xs text-muted-foreground">
          {integer(group.productCount)} produto(s) - {integer(group.totalUnits)} unidade(s)
          {group.withoutSupplier > 0 && ` - ${integer(group.withoutSupplier)} sem fornecedor no cadastro`}
        </p>
      </div>
      <p className="text-sm font-semibold tabular-nums">{money(group.totalCents)}</p>
    </div>
  );
}

/* ---------------- Gerar pedido de compra ---------------- */

function RestockModal({
  open,
  onClose,
  groups,
  alerts,
}: {
  open: boolean;
  onClose: () => void;
  groups: StockAlertsReport['groups'];
  alerts: StockAlertDTO[];
}) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);

  const purchasable = groups.filter((group) => group.supplierId !== null);
  const activeGroup = groups.find((group) => String(group.supplierId ?? '') === supplierId) ?? null;
  const groupAlerts = useMemo(
    () =>
      supplierId === ''
        ? []
        : alerts.filter((alert) => String(alert.supplierId ?? '') === supplierId && alert.suggestedRestock > 0),
    [alerts, supplierId],
  );

  const quantityOf = (alert: StockAlertDTO): number => {
    const raw = quantities[alert.productId];
    if (raw === undefined || raw.trim() === '') return alert.suggestedRestock;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };

  const items = groupAlerts
    .map((alert) => ({ alert, quantity: quantityOf(alert) }))
    .filter((entry) => entry.quantity > 0);

  const totalCents = items.reduce(
    (sum, entry) => sum + (entry.alert.costPrice ?? 0) * entry.quantity,
    0,
  );

  const createOrder = useMutation({
    mutationFn: () =>
      api.post<{ message: string; order: { number: number; supplierName: string } }>(
        '/api/stock/restock-order',
        {
          supplierId: Number(supplierId),
          items: items.map((entry) => ({
            productId: entry.alert.productId,
            quantity: entry.quantity,
            unitCost: entry.alert.costPrice > 0 ? entry.alert.costPrice : undefined,
          })),
          notes: 'Pedido gerado a partir dos alertas de estoque',
        },
      ),
    onSuccess: (result) => {
      toast.success(`Pedido #${result.order.number} criado`, {
        description: `${result.order.supplierName} - ${items.length} item(ns)`,
      });
      setConfirming(false);
      setSupplierId('');
      setQuantities({});
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel criar o pedido.');
    },
  });

  const withoutSupplier = groups.find((group) => group.supplierId === null);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Gerar pedido de compra"
        description="Escolha o fornecedor, revise as quantidades e confirme."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={createOrder.isPending}>
              Cancelar
            </Button>
            <Button
              disabled={supplierId === '' || items.length === 0}
              onClick={() => setConfirming(true)}
            >
              Revisar pedido
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {withoutSupplier && withoutSupplier.productCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {integer(withoutSupplier.productCount)} produto(s) em alerta estao sem fornecedor no
                cadastro. Defina o fornecedor no cadastro do produto para que eles entrem na
                recompra automatica.
              </span>
            </div>
          )}

          <Field label="Fornecedor" htmlFor="restock-supplier" required>
            <Select
              id="restock-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Selecione o fornecedor</option>
              {purchasable.map((group) => (
                <option key={group.supplierId} value={String(group.supplierId)}>
                  {group.supplierName} ({group.productCount} produto(s))
                </option>
              ))}
            </Select>
          </Field>

          {activeGroup && (
            <p className="text-xs text-muted-foreground">
              Total sugerido: {integer(activeGroup.totalUnits)} unidade(s) -{' '}
              {money(activeGroup.totalCents)}
            </p>
          )}

          {supplierId !== '' && groupAlerts.length > 0 && (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="table-compact w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th>Produto</th>
                    <th className="w-20 text-right">Repor</th>
                    <th className="w-24 text-right">Quantidade</th>
                    <th className="w-24 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {groupAlerts.map((alert) => {
                    const quantity = quantityOf(alert);
                    return (
                      <tr key={alert.productId}>
                        <td>
                          <p className="font-medium">{alert.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {alert.unit} - {money(alert.costPrice)} cada
                          </p>
                        </td>
                        <td className="text-right tabular-nums text-muted-foreground">
                          {qty(alert.suggestedRestock)}
                        </td>
                        <td className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={quantities[alert.productId] ?? String(alert.suggestedRestock)}
                            onChange={(event) =>
                              setQuantities((current) => ({
                                ...current,
                                [alert.productId]: event.target.value,
                              }))
                            }
                            className="h-8 text-right tabular-nums"
                            aria-label={`Quantidade para ${alert.name}`}
                          />
                        </td>
                        <td className="text-right tabular-nums">
                          {money(alert.costPrice * quantity)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={3} className="text-right font-semibold">
                      Total do pedido
                    </td>
                    <td className="text-right font-bold tabular-nums">{money(totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {supplierId !== '' && groupAlerts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum produto em alerta para este fornecedor no momento.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => createOrder.mutate()}
        title="Confirmar pedido de compra"
        confirmLabel="Criar pedido"
        loading={createOrder.isPending}
        message={
          <div className="space-y-2 text-sm">
            <p>
              Sera criado um pedido <strong>ABERTO</strong> (nao entra no estoque) para{' '}
              <strong>{activeGroup?.supplierName}</strong> com {items.length} item(ns), totalizando{' '}
              <strong>{money(totalCents)}</strong>.
            </p>
            <p className="text-muted-foreground">
              O recebimento e o que da entrada no estoque e atualiza o custo medio dos produtos.
            </p>
          </div>
        }
      />
    </>
  );
}