import { PAYMENT_METHOD_LABELS, type SaleDTO } from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, Eye, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  EmptyState,
  Modal,
  Pagination,
  type Column,
} from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/input';
import { ApiError, api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/useOnline';
import { dateTime, integer, money, percent } from '@/lib/format';

export function SalesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('CONCLUIDA');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [detail, setDetail] = useState<SaleDTO | null>(null);
  const [canceling, setCanceling] = useState<SaleDTO | null>(null);

  const debouncedSearch = useDebounced(search, 350);

  const listQuery = useQuery({
    queryKey: ['sales', page, debouncedSearch, status, paymentMethod, from, to],
    queryFn: () =>
      api.get<{ data: SaleDTO[]; pagination: { page: number; totalPages: number; total: number } }>(
        '/api/sales',
        {
          page,
          perPage: 25,
          search: debouncedSearch || undefined,
          status: status || undefined,
          paymentMethod: paymentMethod || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      ),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ sale, reason, restock }: { sale: SaleDTO; reason: string; restock: boolean }) =>
      api.post<{ number: number; total: number; restocked: boolean; items: number }>(
        `/api/sales/${sale.id}/cancel`,
        { reason, restock },
      ),
    onSuccess: (result) => {
      toast.success(`Venda #${result.number} cancelada`, {
        description: result.restocked
          ? 'Estoque devolvido aos produtos.'
          : 'Estoque nao foi devolvido.',
      });
      setCanceling(null);
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel cancelar.'),
  });

  const columns = useMemo<Column<SaleDTO>[]>(
    () => [
      {
        key: 'number',
        header: 'Venda',
        className: 'w-24',
        render: (row) => (
          <div>
            <p className="font-semibold tabular-nums">#{row.number}</p>
            <p className="text-xs text-muted-foreground">{dateTime(row.createdAt)}</p>
          </div>
        ),
      },
      {
        key: 'seller',
        header: 'Operador',
        render: (row) => (
          <div>
            <p className="font-medium">{row.userName}</p>
            <p className="text-xs text-muted-foreground">
              Vendedor: {row.sellerName}
              {row.customerName && ` · ${row.customerName}`}
            </p>
          </div>
        ),
      },
      {
        key: 'items',
        header: 'Itens',
        className: 'w-20 text-right',
        render: (row) => <span className="tabular-nums">{integer(row.itemsCount)}</span>,
      },
      {
        key: 'payment',
        header: 'Pagamento',
        className: 'w-36',
        render: (row) => (
          <div>
            <p className="text-sm">{PAYMENT_METHOD_LABELS[row.paymentMethod]}</p>
            {row.amountPaidCents > row.total && (
              <p className="text-xs text-muted-foreground">Troco {money(row.changeCents)}</p>
            )}
          </div>
        ),
      },
      {
        key: 'total',
        header: 'Total',
        className: 'w-32 text-right',
        render: (row) => (
          <div>
            <p className="font-semibold tabular-nums">{money(row.total)}</p>
            {row.discountCents > 0 && (
              <p className="text-xs text-accent-foreground">-{money(row.discountCents)}</p>
            )}
          </div>
        ),
      },
      {
        key: 'profit',
        header: 'Lucro',
        className: 'w-28 text-right',
        render: (row) => (
          <span className="tabular-nums text-success">{money(row.profitCents)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Situacao',
        className: 'w-28',
        render: (row) => (
          <Badge tone={row.status === 'CONCLUIDA' ? 'success' : 'destructive'}>
            {row.status === 'CONCLUIDA' ? 'Concluida' : 'Cancelada'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-24',
        render: (row) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => setDetail(row)}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Ver detalhes"
              aria-label={`Ver detalhes da venda ${row.number}`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
            </button>
            {can('sales:cancel') && row.status === 'CONCLUIDA' && (
              <button
                type="button"
                onClick={() => setCanceling(row)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Cancelar venda"
                aria-label={`Cancelar venda ${row.number}`}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        ),
      },
    ],
    [can],
  );

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Receipt className="h-5 w-5 text-accent" aria-hidden />
            Vendas
          </h1>
          <p className="text-sm text-muted-foreground">
            {can('sales:read-all')
              ? 'Todas as vendas registradas'
              : 'Suas vendas registradas'}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            void downloadFile(
              '/api/reports/vendas',
              { format: 'csv', from: from || undefined, to: to || undefined },
              'vendas.csv',
            ).catch(() => toast.error('Nao foi possivel exportar.'))
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          Exportar
        </Button>
      </div>

      <Card>
        <CardHeader
          title="Historico de vendas"
          description={`${listQuery.data?.pagination.total ?? 0} venda(s)`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Numero ou observacao"
                className="w-44"
              />
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="w-32"
                aria-label="Filtrar por situacao"
              >
                <option value="CONCLUIDA">Concluidas</option>
                <option value="CANCELADA">Canceladas</option>
                <option value="">Todas</option>
              </Select>
              <Select
                value={paymentMethod}
                onChange={(event) => {
                  setPaymentMethod(event.target.value);
                  setPage(1);
                }}
                className="w-40"
                aria-label="Filtrar por forma de pagamento"
              >
                <option value="">Todo pagamento</option>
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
                className="w-36"
                aria-label="Data inicial"
              />
              <Input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
                className="w-36"
                aria-label="Data final"
              />
            </div>
          }
        />
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            onRowClick={(row) => setDetail(row)}
            loading={listQuery.isLoading}
            emptyState={
              <EmptyState
                title="Nenhuma venda encontrada"
                description="Ajuste os filtros ou registre uma venda no PDV."
                icon={<Receipt className="h-8 w-8" aria-hidden />}
              />
            }
          />
          {listQuery.data && (
            <Pagination
              page={listQuery.data.pagination.page}
              totalPages={listQuery.data.pagination.totalPages}
              total={listQuery.data.pagination.total}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>

      <SaleDetailModal sale={detail} onClose={() => setDetail(null)} />
      <CancelModal
        sale={canceling}
        loading={cancelMutation.isPending}
        onClose={() => setCanceling(null)}
        onConfirm={(reason, restock) => canceling && cancelMutation.mutate({ sale: canceling, reason, restock })}
      />
    </div>
  );
}

/* ---------------- Detalhe da venda ---------------- */

function SaleDetailModal({ sale, onClose }: { sale: SaleDTO | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['sale', sale?.id],
    queryFn: () => api.get<SaleDTO>(`/api/sales/${sale!.id}`),
    enabled: sale !== null,
  });

  const current = data ?? sale;
  if (!sale || !current) return null;

  const margin =
    current.total > 0 ? ((current.profitCents / current.total) * 100) : 0;

  return (
    <Modal open onClose={onClose} title={`Venda #${current.number}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Data</p>
            <p className="font-medium">{dateTime(current.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Operador</p>
            <p className="font-medium">{current.userName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Vendedor</p>
            <p className="font-medium">{current.sellerName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pagamento</p>
            <p className="font-medium">{PAYMENT_METHOD_LABELS[current.paymentMethod]}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="table-compact w-full">
            <thead className="bg-muted/50">
              <tr>
                <th>Item</th>
                <th className="text-right">Qtd</th>
                <th className="text-right">Unit.</th>
                <th className="text-right">Desc.</th>
                <th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(current.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    <p className="font-medium">{item.productName}</p>
                    {item.barcode && (
                      <p className="font-mono text-xs text-muted-foreground">{item.barcode}</p>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {integer(item.quantity)} {item.productUnit}
                  </td>
                  <td className="text-right tabular-nums">{money(item.unitPrice)}</td>
                  <td className="text-right tabular-nums">
                    {item.discountPercent > 0 ? `${percent(item.discountPercent)}` : '-'}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{money(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{money(current.subtotal)}</dd>
          </div>
          {current.discountCents > 0 && (
            <div className="flex justify-between text-accent-foreground">
              <dt>Desconto</dt>
              <dd className="tabular-nums">-{money(current.discountCents)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(current.total)}</dd>
          </div>
          {current.amountPaidCents > current.total && (
            <>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Recebido</dt>
                <dd className="tabular-nums">{money(current.amountPaidCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Troco</dt>
                <dd className="tabular-nums">{money(current.changeCents)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-border pt-1.5 text-success">
            <dt>Lucro estimado ({percent(margin)})</dt>
            <dd className="tabular-nums">{money(current.profitCents)}</dd>
          </div>
        </dl>

        {current.notes && (
          <p className="rounded-md bg-muted p-2 text-sm">
            <strong>Observacao:</strong> {current.notes}
          </p>
        )}

        {current.status === 'CANCELADA' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <p className="font-semibold text-destructive">Venda cancelada</p>
            <p>{current.cancelReason}</p>
            <p className="text-muted-foreground">{dateTime(current.canceledAt)}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- Cancelamento ---------------- */

function CancelModal({
  sale,
  loading,
  onClose,
  onConfirm,
}: {
  sale: SaleDTO | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string, restock: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);

  if (!sale) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancelar venda #${sale.number}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Voltar
          </Button>
          <Button
            variant="destructive"
            loading={loading}
            disabled={reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim(), restock)}
          >
            Confirmar cancelamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <span>Total da venda</span>
            <span className="font-semibold tabular-nums">{money(sale.total)}</span>
          </div>
          <div className="flex justify-between">
            <span>Itens</span>
            <span className="tabular-nums">{integer(sale.itemsCount)}</span>
          </div>
        </div>

        <Field
          label="Motivo do cancelamento"
          htmlFor="cancel-reason"
          required
          hint="Ficara registrado na auditoria. Minimo de 3 caracteres."
        >
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: cliente desistiu da compra"
            autoFocus
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={restock}
            onChange={(event) => setRestock(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">Devolver itens ao estoque</span>
            <span className="block text-xs text-muted-foreground">
              Marque esta opcao somente se os produtos voltarem a ficar disponiveis para venda.
              Desmarque se os itens sairam da loja.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}