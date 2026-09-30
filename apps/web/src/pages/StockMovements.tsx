import {
  STOCK_MOVEMENT_LABELS,
  STOCK_MOVEMENT_TYPES,
  type StockMovementDTO,
  type StockMovementType,
} from '@webdist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Sliders } from 'lucide-react';
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
import { Field, Input, SearchInput, Select } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useBarcodeListener } from '@/lib/BarcodeContext';
import { normalizeBarcode } from '@/lib/barcode';
import { useDebounced } from '@/lib/useOnline';
import { dateTime, integer, qty } from '@/lib/format';

export function StockMovementsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [movementOpen, setMovementOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Global barcode listener for product lookup in stock movements
  useBarcodeListener('STOCK_LOOKUP', (code) => {
    if (!movementOpen && !adjustOpen) {
      const clean = normalizeBarcode(code);
      setSearch(clean);
      setPage(1);
      toast.info('Buscando movimentacoes do produto', { description: clean });
    }
  }, 'stock-movements-search');

  const debouncedSearch = useDebounced(search, 350);

  const listQuery = useQuery({
    queryKey: ['stock', 'movements', page, debouncedSearch, type, from, to],
    queryFn: () =>
      api.get<{
        data: StockMovementDTO[];
        pagination: { page: number; totalPages: number; total: number };
      }>('/api/stock/movements', {
        page,
        perPage: 30,
        q: debouncedSearch || undefined,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
      }),
  });

  const columns = useMemo<Column<StockMovementDTO>[]>(
    () => [
      {
        key: 'date',
        header: 'Data',
        className: 'whitespace-nowrap',
        render: (row) => <span className="text-muted-foreground">{dateTime(row.createdAt)}</span>,
      },
      {
        key: 'type',
        header: 'Tipo',
        className: 'w-40',
        render: (row) => (
          <Badge
            tone={
              row.type === 'ENTRADA' || row.type === 'DEVOLUCAO' || row.type === 'TRANSFERENCIA_ENTRADA'
                ? 'success'
                : row.type === 'AJUSTE'
                  ? 'muted'
                  : 'destructive'
            }
          >
            {STOCK_MOVEMENT_LABELS[row.type]}
          </Badge>
        ),
      },
      {
        key: 'product',
        header: 'Produto',
        render: (row) => (
          <div>
            <p className="font-medium">{row.productName}</p>
            {row.documentNumber && (
              <p className="text-xs text-muted-foreground">Doc: {row.documentNumber}</p>
            )}
          </div>
        ),
      },
      {
        key: 'quantity',
        header: 'Qtd',
        className: 'w-28 text-right',
        render: (row) => {
          const positive =
            row.type === 'ENTRADA' || row.type === 'DEVOLUCAO' || row.type === 'TRANSFERENCIA_ENTRADA';
          const delta = row.resultingStock - row.previousStock;
          return (
            <div>
              <p
                className={`font-semibold tabular-nums ${positive ? 'text-success' : 'text-destructive'}`}
              >
                {positive ? '+' : ''}
                {qty(row.quantity)} {row.productUnit}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                saldo {delta > 0 ? '+' : ''}
                {delta}
              </p>
            </div>
          );
        },
      },
      {
        key: 'stock',
        header: 'Estoque',
        className: 'w-32 text-right',
        render: (row) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {integer(row.previousStock)} → <strong className="text-foreground">{integer(row.resultingStock)}</strong>
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Motivo',
        render: (row) => <span className="text-sm">{row.reason}</span>,
      },
      {
        key: 'user',
        header: 'Responsavel',
        className: 'w-40',
        render: (row) => <span className="text-sm text-muted-foreground">{row.userName}</span>,
      },
    ],
    [],
  );

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ArrowLeftRight className="h-5 w-5 text-accent" aria-hidden />
            Movimentacoes de estoque
          </h1>
          <p className="text-sm text-muted-foreground">
            {listQuery.data?.pagination.total ?? 0} registro(s) - rastro completo do estoque
          </p>
        </div>
        {can('stock:adjust') && (
          <Button variant="outline" onClick={() => setAdjustOpen(true)}>
            <Sliders className="h-4 w-4" aria-hidden />
            Ajustar estoque
          </Button>
        )}
        {can('stock:receive') && (
          <Button onClick={() => setMovementOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Nova movimentacao
          </Button>
        )}
      </div>

      <Card>
        <CardHeader
          title="Historico"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Produto ou documento"
                className="w-48"
              />
              <Select
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setPage(1);
                }}
                className="w-44"
                aria-label="Filtrar por tipo"
              >
                <option value="">Todos os tipos</option>
                {STOCK_MOVEMENT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {STOCK_MOVEMENT_LABELS[option]}
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
            loading={listQuery.isLoading}
            emptyState={
              <EmptyState
                title="Nenhuma movimentacao encontrada"
                description="Registre entradas e saidas para manter o estoque atualizado."
                icon={<ArrowLeftRight className="h-8 w-8" aria-hidden />}
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

      <MovementModal
        open={movementOpen}
        onClose={() => setMovementOpen(false)}
        onSaved={() => {
          setMovementOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['stock'] });
        }}
      />
      <AdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSaved={() => {
          setAdjustOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['stock'] });
        }}
      />
    </div>
  );
}

/* ---------------- Select de produto com busca ---------------- */

function ProductPicker({
  value,
  onChange,
}: {
  value: { id: number; name: string; unit: string; stock: number } | null;
  onChange: (product: { id: number; name: string; unit: string; stock: number }) => void;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);

  const { data } = useQuery({
    queryKey: ['products', 'picker', debounced],
    queryFn: () =>
      api.get<{ data: { id: number; name: string; unit: string; stock: number }[] }>(
        '/api/products',
        { q: debounced || undefined, perPage: 20, status: 'ATIVO' },
      ),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted p-2">
          <div>
            <p className="text-sm font-medium">{value.name}</p>
            <p className="text-xs text-muted-foreground">
              Estoque atual: {qty(value.stock)} {value.unit}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange({ id: 0, name: '', unit: '', stock: 0 })}>
            Trocar
          </Button>
        </div>
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Digite ao menos 2 letras do produto"
          />
          {data && data.data.length > 0 && (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {data.data.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onChange(product)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{product.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {qty(product.stock)} {product.unit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Nova movimentacao ---------------- */

function MovementModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [product, setProduct] = useState<{ id: number; name: string; unit: string; stock: number } | null>(null);
  const [type, setType] = useState<StockMovementType>('ENTRADA');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEntry = type === 'ENTRADA' || type === 'DEVOLUCAO' || type === 'TRANSFERENCIA_ENTRADA';

  const submit = async () => {
    setError(null);
    if (!product || product.id === 0) return setError('Selecione um produto.');
    const qtyValue = Number(quantity);
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) return setError('Informe uma quantidade maior que zero.');
    if (reason.trim().length < 3) return setError('Descreva o motivo da movimentacao.');
    if (!isEntry && qtyValue > product.stock) {
      return setError(`Estoque insuficiente: disponivel ${product.stock} ${product.unit}.`);
    }
    setLoading(true);
    try {
      await api.post('/api/stock/movements', {
        productId: product.id,
        type,
        quantity: qtyValue,
        reason: reason.trim(),
        documentNumber: documentNumber.trim() || undefined,
        unitCost: isEntry && unitCost.trim() ? Number(unitCost) : undefined,
      });
      toast.success('Movimentacao registrada.');
      setProduct(null);
      setQuantity('');
      setReason('');
      setDocumentNumber('');
      setUnitCost('');
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel registrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova movimentacao de estoque"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={loading}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Field label="Produto" required>
          <ProductPicker
            value={product && product.id !== 0 ? product : null}
            onChange={(chosen) => (chosen.id === 0 ? setProduct(null) : setProduct(chosen))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" htmlFor="mv-type" required>
            <Select
              id="mv-type"
              value={type}
              onChange={(event) => setType(event.target.value as StockMovementType)}
            >
              {STOCK_MOVEMENT_TYPES.filter((option) => option !== 'AJUSTE').map((option) => (
                <option key={option} value={option}>
                  {STOCK_MOVEMENT_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={`Quantidade${product ? ` (${product.unit})` : ''}`}
            htmlFor="mv-qty"
            required
            hint={product ? `Disponivel: ${qty(product.stock)} ${product.unit}` : undefined}
          >
            <Input
              id="mv-qty"
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Motivo" htmlFor="mv-reason" required>
          <Input
            id="mv-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: compra de mercadoria, nota fiscal 12345"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Documento (opcional)" htmlFor="mv-doc">
            <Input
              id="mv-doc"
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder="NF, pedido, contrato"
            />
          </Field>
          {isEntry && (
            <Field
              label="Custo unitario (opcional)"
              htmlFor="mv-cost"
              hint="Atualiza o custo medio ponderado."
            >
              <Input
                id="mv-cost"
                value={unitCost}
                onChange={(event) => setUnitCost(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Ajuste ---------------- */

function AdjustModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [product, setProduct] = useState<{ id: number; name: string; unit: string; stock: number } | null>(null);
  const [newStock, setNewStock] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = Number(newStock);
  const delta = product && Number.isFinite(target) ? target - product.stock : 0;

  const submit = async () => {
    setError(null);
    if (!product || product.id === 0) return setError('Selecione um produto.');
    if (!Number.isFinite(target) || target < 0) return setError('Informe um estoque alvo valido.');
    if (delta === 0) return setError('O estoque alvo e igual ao atual.');
    if (reason.trim().length < 3) return setError('Justifique o ajuste - ele fica na auditoria.');
    setLoading(true);
    try {
      await api.post('/api/stock/adjust', {
        productId: product.id,
        newStock: target,
        reason: reason.trim(),
      });
      toast.success('Estoque ajustado.', {
        description: `${product.name}: ${product.stock} → ${target}`,
      });
      setProduct(null);
      setNewStock('');
      setReason('');
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel ajustar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajustar estoque"
      description="Informe a quantidade real de items. O historico anterior e preservado."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={loading}>
            Aplicar ajuste
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Field label="Produto" required>
          <ProductPicker
            value={product && product.id !== 0 ? product : null}
            onChange={(chosen) => {
              if (chosen.id === 0) {
                setProduct(null);
                return;
              }
              setProduct(chosen);
              setNewStock(String(chosen.stock));
            }}
          />
        </Field>

        {product && product.id !== 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Estoque atual" htmlFor="adj-current">
                <Input
                  id="adj-current"
                  value={`${qty(product.stock)} ${product.unit}`}
                  disabled
                  readOnly
                />
              </Field>
              <Field label="Estoque real (contado)" htmlFor="adj-target" required>
                <Input
                  id="adj-target"
                  type="number"
                  min={0}
                  step="any"
                  value={newStock}
                  onChange={(event) => setNewStock(event.target.value)}
                />
              </Field>
            </div>

            {Number.isFinite(target) && delta !== 0 && (
              <div
                className={`rounded-md border p-3 text-sm ${
                  delta > 0
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                Diferenca: <strong>{delta > 0 ? '+' : ''}{qty(delta)}</strong> {product.unit}
              </div>
            )}
          </>
        )}

        <Field label="Justificativa" htmlFor="adj-reason" required>
          <Input
            id="adj-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: contagem fisica divergente, avaria no transporte"
          />
        </Field>
      </div>
    </Modal>
  );
}