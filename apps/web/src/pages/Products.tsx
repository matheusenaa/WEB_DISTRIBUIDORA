import { PRODUCT_UNITS, STOCK_ALERT_LABELS, type ProductDTO } from '@webdist/shared';
import { marginFromPrice, parseMoneyToCents, priceFromMargin, priceFromMarkup } from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Download, Package, Plus, Upload, FileText, CheckSquare, AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  Pagination,
  type Column,
} from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, FormError, Input, SearchInput, Select, Textarea } from '@/components/ui/input';
import { ApiError, api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isValidCheckDigit, normalizeBarcode, useBarcodeHandler } from '@/lib/barcode/BarcodeManager';
import { useDebounced } from '@/lib/useOnline';
import { integer, money, percent } from '@/lib/format';

interface LookupOption {
  id: number;
  name: string;
}

export function ProductsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState('ATIVO');
  const [alert, setAlert] = useState('');

  const [editing, setEditing] = useState<ProductDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  // Codigo lido que nao existe no cadastro: abre o formulario ja preenchido
  // para o operador completar e salvar, em vez de obrigar a digitar de novo.
  const [prefillBarcode, setPrefillBarcode] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProductDTO | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nfeImportOpen, setNfeImportOpen] = useState(false);

  // Leitura na listagem: filtra pelo codigo. Desregistrado enquanto o
  // formulario esta aberto, para o formulario receber a leitura.
  useBarcodeHandler(
    'PRODUCT_SEARCH',
    (result) => {
      setSearch(result.code);
      setPage(1);
      if (result.found) {
        toast.info('Produto encontrado pelo leitor.', {
          description: `${result.code} - ${result.product?.name ?? ''}`,
        });
      } else {
        toast.info('Codigo nao cadastrado. Abrindo cadastro.', {
          description: result.code,
        });
        setEditing(null);
        setPrefillBarcode(result.code);
        setFormOpen(true);
      }
    },
    !formOpen,
  );

  const debouncedSearch = useDebounced(search, 350);

  const listQuery = useQuery({
    queryKey: ['products', page, debouncedSearch, categoryId, brandId, status, alert],
    queryFn: () =>
      api.get<{
        data: ProductDTO[];
        pagination: { page: number; totalPages: number; total: number };
      }>('/api/products', {
        page,
        perPage: 25,
        q: debouncedSearch || undefined,
        categoryId: categoryId || undefined,
        brandId: brandId || undefined,
        status: status || undefined,
        alertLevel: alert || undefined,
      }),
  });

  const categories = useQuery({
    queryKey: ['categories', 'lookup'],
    queryFn: () =>
      api.get<{ data: LookupOption[] }>('/api/categories', { perPage: 200, active: true }),
staleTime: 5 * 60_000,
  });
  const brands = useQuery({
    queryKey: ['brands', 'lookup'],
    queryFn: () => api.get<{ data: LookupOption[] }>('/api/brands', { perPage: 200, active: true }),
    staleTime: 5 * 60_000,
  });
  // Fornecedor e o elo com compras e recompras (Fase 8): o preco de custo do
  // produto so tem origem confiavel quando o fornecedor esta identificado.
  const suppliers = useQuery({
    queryKey: ['suppliers', 'lookup'],
    queryFn: () => api.get<{ data: LookupOption[] }>('/api/suppliers', { perPage: 200 }),
    staleTime: 5 * 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  const toggleStatus = useMutation({
    mutationFn: (product: ProductDTO) =>
      api.post(`/api/products/${product.id}/status`, {
        status: product.status === 'ATIVO' ? 'INATIVO' : 'ATIVO',
      }),
    onSuccess: () => {
      toast.success('Situacao do produto atualizada.');
      void invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel alterar.'),
  });

  const removeMutation = useMutation({
    mutationFn: (product: ProductDTO) => api.delete(`/api/products/${product.id}`),
    onSuccess: () => {
      toast.success('Produto excluido.');
      setDeleting(null);
      void invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel excluir.'),
  });

  const columns = useMemo<Column<ProductDTO>[]>(() => {
    const base: Column<ProductDTO>[] = [
      {
        key: 'name',
        header: 'Produto',
        render: (row) => (
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {row.barcode && (
                <span className="flex items-center gap-1 font-mono">
                  <Barcode className="h-3 w-3" aria-hidden />
                  {row.barcode}
                </span>
)}
              {row.internalCode && <span>Cod. {row.internalCode}</span>}
              {row.categoryName && <span>{row.categoryName}</span>}
              {row.brandName && <span>{row.brandName}</span>}
              {row.supplierName && <span>{row.supplierName}</span>}
            </p>
          </div>
        ),
      },
      {
        key: 'cost',
        header: 'Custo',
        className: 'w-28 text-right',
        render: (row) => <span className="tabular-nums">{money(row.costPrice)}</span>,
      },
      {
        key: 'price',
        header: 'Venda',
        className: 'w-28 text-right',
        render: (row) => <span className="font-semibold tabular-nums">{money(row.salePrice)}</span>,
      },
      {
        key: 'margin',
        header: 'Margem',
        className: 'w-24 text-right',
        render: (row) => (
          <span
            className={
              row.marginPercent < 10
                ? 'font-semibold tabular-nums text-destructive'
                : row.marginPercent < 20
                  ? 'font-semibold tabular-nums text-warning'
                  : 'tabular-nums text-success'
}
          >
            {percent(row.marginPercent)}
          </span>
        ),
      },
      {
        key: 'markup',
        header: 'Markup',
        className: 'w-24 text-right',
        render: (row) => (
          <span className="tabular-nums text-muted-foreground">{percent(row.markupPercent)}</span>
        ),
      },
      {
        key: 'location',
        header: 'Local',
        className: 'w-36',
        render: (row) =>
          row.location ? (
            <span className="text-xs text-muted-foreground">{row.location}</span>
          ) : (
            <span className="text-xs text-muted-foreground/60">-</span>
          ),
      },
      {
        key: 'stock',
        header: 'Estoque',
        className: 'w-32 text-right',
        render: (row) => (
          <div>
            <p className="font-semibold tabular-nums">
              {integer(row.stock)} <span className="font-normal text-muted-foreground">{row.unit}</span>
            </p>
            {row.alertLevel && (
              <Badge tone={row.alertLevel === 'ZERADO' ? 'destructive' : row.alertLevel === 'CRITICO' ? 'warning' : 'muted'}>
                {STOCK_ALERT_LABELS[row.alertLevel]}
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Situacao',
        className: 'w-24',
        render: (row) => (
          <Badge tone={row.status === 'ATIVO' ? 'success' : 'muted'}>
            {row.status === 'ATIVO' ? 'Ativo' : 'Inativo'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-40',
        render: (row) => (
          <div className="flex justify-end gap-1">
            {can('products:update') && (
              <button
                type="button"
                onClick={() => {
                  setEditing(row);
                  setFormOpen(true);
                }}
                className="rounded border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
              >
                Editar
              </button>
            )}
            {can('products:update') && (
              <button
                type="button"
                onClick={() => toggleStatus.mutate(row)}
                className="rounded border border-input px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
              >
                {row.status === 'ATIVO' ? 'Desativar' : 'Ativar'}
              </button>
            )}
            {can('products:delete') && (
              <button
                type="button"
                onClick={() => setDeleting(row)}
                className="rounded border border-input px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Excluir
              </button>
            )}
          </div>
        ),
      },
    ];
    return base;
  }, [can, toggleStatus]);

  const rows = listQuery.data?.data ?? [];

  const onImportFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch('/api/products/import/csv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('wd.accessToken') ?? ''}` },
        body: formData,
      });
      const body = (await response.json()) as {
        imported?: number;
        updated?: number;
        errors?: string[];
        error?: { message: string };
      };
      if (!response.ok) throw new ApiError(response.status, body as never, 'Falha na importacao.');
      toast.success('Importacao concluida', {
        description: `${body.imported ?? 0} criado(s), ${body.updated ?? 0} atualizado(s).`,
      });
      if (body.errors && body.errors.length > 0) {
        toast.warning(`${body.errors.length} linha(s) ignorada(s).`, { duration: 8000 });
      }
      setImportOpen(false);
      void invalidate();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Erro ao importar o arquivo.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Package className="h-5 w-5 text-accent" aria-hidden />
            Produtos
          </h1>
          <p className="text-sm text-muted-foreground">
            {listQuery.data?.pagination.total ?? 0} produto(s) cadastrado(s)
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() =>
            void downloadFile('/api/products/export/csv', {}, 'produtos.csv').catch(() =>
              toast.error('Nao foi possivel exportar.'),
            )
          }
        >
          <Download className="h-4 w-4" aria-hidden />
          Exportar
        </Button>
{can('products:create') && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" aria-hidden />
            Importar CSV
          </Button>
        )}
        {can('products:create') && (
          <Button variant="outline" onClick={() => setNfeImportOpen(true)}>
            <FileText className="h-4 w-4" aria-hidden />
            Importar NF-e
          </Button>
        )}
        {can('products:create') && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo produto
          </Button>
        )}
      </div>

      <Card>
        <CardHeader
          title="Catalogo"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Nome ou codigo de barras"
                className="w-56"
              />
              <Select
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setPage(1);
                }}
                className="w-40"
                aria-label="Filtrar por categoria"
              >
                <option value="">Todas as categorias</option>
                {categories.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select
                value={brandId}
                onChange={(event) => {
                  setBrandId(event.target.value);
                  setPage(1);
                }}
                className="w-36"
                aria-label="Filtrar por marca"
              >
                <option value="">Todas as marcas</option>
                {brands.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select
                value={alert}
                onChange={(event) => {
                  setAlert(event.target.value);
                  setPage(1);
                }}
                className="w-36"
                aria-label="Filtrar por alerta de estoque"
              >
                <option value="">Qualquer estoque</option>
                <option value="ZERADO">Zerado</option>
                <option value="CRITICO">Critico</option>
                <option value="BAIXO">Baixo</option>
              </Select>
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="w-28"
                aria-label="Filtrar por situacao"
              >
                <option value="ATIVO">Ativos</option>
                <option value="INATIVO">Inativos</option>
                <option value="">Todos</option>
              </Select>
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
                title="Nenhum produto encontrado"
                description="Ajuste os filtros ou cadastre um novo produto."
                icon={<Package className="h-8 w-8" aria-hidden />}
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

      <ProductForm
        open={formOpen}
        product={editing}
        categories={categories.data?.data ?? []}
        brands={brands.data?.data ?? []}
        suppliers={suppliers.data?.data ?? []}
        prefillBarcode={prefillBarcode}
        onClose={() => {
          setFormOpen(false);
          setPrefillBarcode(null);
        }}
        onSaved={() => {
          setFormOpen(false);
          setPrefillBarcode(null);
          void invalidate();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && removeMutation.mutate(deleting)}
        loading={removeMutation.isPending}
        destructive
        title="Excluir produto"
        confirmLabel="Excluir"
        message={
          <>
            Excluir <strong>{deleting?.name}</strong> permanentemente?
            <br />
            <span className="text-muted-foreground">
              Produtos com movimentacao ou vendas nao podem ser excluidos - desative o produto.
            </span>
          </>
        }
      />

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar produtos por CSV"
        size="md"
      >
        <div className="space-y-3 text-sm">
          <p>
            Envie um arquivo <code className="rounded bg-muted px-1">.csv</code> com o cabecalho na
            primeira linha. Use o modelo exportado para nao errar os nomes das colunas.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Clique em Exportar para obter um modelo.</li>
            <li>Preencha os produtos. Codigo de barras vazio e permitido.</li>
            <li>Produtos existentes com o mesmo codigo sao atualizados.</li>
          </ol>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImportFile(file);
              event.target.value = '';
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Fechar
            </Button>
            <Button
              onClick={() => {
                fileRef.current?.click();
              }}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Escolher arquivo
            </Button>
</div>
        </div>
      </Modal>

      <NfeImportModal
        open={nfeImportOpen}
        onClose={() => setNfeImportOpen(false)}
        onSuccess={invalidate}
      />
    </div>
  );
}

/* ---------------- Modal de importacao NF-e ---------------- */

interface NfePreviewRow {
  line: number;
  name: string;
  ean: string | null;
  code: string | null;
  unit: string;
  quantity: number;
  unitValueCents: number;
  totalCents: number;
  action: 'CRIAR' | 'ATUALIZAR' | 'IGNORAR';
  matchedProductId: number | null;
  matchedProductName: string | null;
  currentSalePriceCents: number | null;
  reason: string | null;
  matchedBy: 'EAN' | 'CODIGO' | null;
}

interface NfePreview {
  supplier: {
    id: number | null;
    name: string | null;
    document: string | null;
    found: boolean;
  };
  note: {
    number: string | null;
    series: string | null;
    accessKey: string | null;
    issueDate: string | null;
    totalCents: number | null;
  };
  rows: NfePreviewRow[];
  summary: {
    create: number;
    update: number;
    ignore: number;
    itemsRead: number;
    totalCents: number;
  };
  warnings: string[];
  errors: Array<{ line: number; reason: string }>;
}

interface NfeConfirmResult {
  created: number;
  updated: number;
  skipped: number;
  stockMovements: number;
  supplierId: number | null;
  errors: Array<{ line: number; reason: string }>;
  message: string;
}

function NfeImportModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'preview' | 'confirming'>('upload');
  const [preview, setPreview] = useState<NfePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmResult, setConfirmResult] = useState<NfeConfirmResult | null>(null);

  const handleFileSelect = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setError('Selecione um arquivo XML da NF-e.');
      return;
    }
    setError(null);
    const text = await file.text();
    try {
      const res = await api.post<NfePreview>('/api/products/import/nfe/preview', {
        xml: text,
        updateExisting,
      });
      setPreview(res);
      const initial = new Set<number>();
      res.rows.forEach((r: NfePreviewRow) => {
        if (r.action !== 'IGNORAR') initial.add(r.line);
      });
      setSelectedLines(initial);
      setStep('preview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao ler a NF-e.');
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setStep('confirming');
    try {
      const res = await api.post<NfeConfirmResult>('/api/products/import/nfe/confirm', {
        xml: '',
        lines: Array.from(selectedLines),
        updateExisting,
        applyStock: true,
      });
      setConfirmResult(res);
      toast.success('Importacao NF-e concluida', {
        description: res.message,
      });
      onSuccess();
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao importar.');
      setStep('preview');
    }
  };

  const handleBack = () => {
    if (step === 'preview') {
      setStep('upload');
    } else if (step === 'confirming') {
      setStep('preview');
    }
  };

  const toggleLine = (line: number) => {
    const next = new Set(selectedLines);
    if (next.has(line)) next.delete(line);
    else next.add(line);
    setSelectedLines(next);
  };

  const toggleAll = (includeIgnored = false) => {
    if (!preview) return;
    const next = new Set<number>();
    preview.rows.forEach((r) => {
      if (includeIgnored || r.action !== 'IGNORAR') next.add(r.line);
    });
    setSelectedLines(next);
  };

  if (step === 'confirming' && confirmResult) {
    return (
      <Modal open={open} onClose={onClose} title="Importacao concluida" size="md">
        <div className="space-y-3">
          <p className="text-green-600 font-medium">{confirmResult.message}</p>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              <strong>Criados:</strong> {confirmResult.created} &nbsp;|&nbsp;
              <strong>Atualizados:</strong> {confirmResult.updated} &nbsp;|&nbsp;
              <strong>Entradas de estoque:</strong> {confirmResult.stockMovements}
            </p>
            {confirmResult.errors.length > 0 && (
              <p className="text-destructive">
                <strong>Erros:</strong> {confirmResult.errors.length}
              </p>
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={() => { handleBack(); if (step === 'upload') onClose(); }} title="Importar NF-e" size="lg">
      {error && <FormError>{error}</FormError>}

      {step === 'upload' && (
        <div className="space-y-4 text-center py-4">
          <FileText className="h-16 w-16 text-muted-foreground/50 mx-auto" aria-hidden />
          <h3 className="text-lg font-semibold">Selecione o arquivo XML da NF-e</h3>
          <p className="text-sm text-muted-foreground">
            Arraste o arquivo aqui ou clique para escolher.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileSelect(file);
              event.target.value = '';
            }}
          />
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => onClose()}>
              Cancelar
            </Button>
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={fileRef.current?.files?.length === 0}
            >
              <Upload className="h-4 w-4" aria-hidden />
              Escolher arquivo
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Numero / Serie</p>
                <p className="font-mono">{preview.note.number ?? '-'} / {preview.note.series ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Chave de acesso</p>
                <p className="font-mono text-xs truncate">{preview.note.accessKey ?? '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Emitente</p>
                <p>{preview.supplier.found ? (
                  <>
                    <span className="text-green-600">● </span>
                    {preview.supplier.name} ({preview.supplier.document})
                  </>
                ) : (
                  <>
                    <span className="text-warning">● </span>
                    {preview.supplier.name ?? 'Nao encontrado'}
                  </>
                )}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Checkbox
              label="Atualizar produtos existentes (sobrescreve preco de venda pelo da nota)"
              checked={updateExisting}
              onChange={(e) => setUpdateExisting(e.target.checked)}
            />
            <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
              <CheckSquare className="h-3 w-3" aria-hidden />
              Selecionar CRIAR/ATUALIZAR
            </Button>
            <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
              Selecionar tudo
            </Button>
          </div>

          <div className="rounded-md border border-border overflow-hidden max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="w-10 text-center p-2">
                    <Checkbox
                      label="Selecionar tudo"
                      checked={selectedLines.size === preview.rows.filter((r) => r.action !== 'IGNORAR').length}
                      onChange={() => toggleAll(false)}
                    />
                  </th>
                  <th className="text-left p-2">Produto</th>
                  <th className="text-left p-2 w-36">EAN / Codigo</th>
                  <th className="text-center p-2 w-16">UN</th>
                  <th className="text-right p-2 w-20">Qtd</th>
                  <th className="text-right p-2 w-24">Vl. Unit.</th>
                  <th className="text-right p-2 w-24">Total</th>
                  <th className="text-center p-2 w-24">Acao</th>
                  <th className="text-left p-2">Correspondencia</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-t border-border hover:bg-muted/30">
                    <td className="text-center p-2">
                      <Checkbox
                        label=""
                        checked={selectedLines.has(row.line)}
                        onChange={() => toggleLine(row.line)}
                        disabled={row.action === 'IGNORAR'}
                      />
                    </td>
                    <td className="p-2 font-medium">{row.name}</td>
                    <td className="p-2 font-mono text-xs">
                      {row.ean || <span className="text-muted-foreground">sem EAN</span>}
                      {row.code && <span className="ml-1 text-muted-foreground">/ {row.code}</span>}
                    </td>
                    <td className="text-center p-2">{row.unit}</td>
                    <td className="text-right p-2 tabular-nums">{integer(row.quantity)}</td>
                    <td className="text-right p-2 tabular-nums">{money(row.unitValueCents)}</td>
                    <td className="text-right p-2 tabular-nums">{money(row.totalCents)}</td>
                    <td className="text-center p-2">
                      <Badge
                        tone={
                          row.action === 'CRIAR' ? 'success' :
                          row.action === 'ATUALIZAR' ? 'default' : 'muted'
                        }
                      >
                        {row.action}
                      </Badge>
                    </td>
                    <td className="p-2 text-xs">
                      {row.matchedProductId ? (
                        <>
                          <span className="font-mono">ID {row.matchedProductId}</span>
                          <br />
                          <span className="text-muted-foreground">{row.matchedProductName}</span>
                          {row.currentSalePriceCents !== null && row.action === 'ATUALIZAR' && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-destructive">
                                Venda: {money(row.currentSalePriceCents)}
                              </span>
                              <RefreshCw className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-success">
                                Nota: {money(row.unitValueCents)}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Novo produto</span>
                      )}
                      {row.reason && (
                        <p className="text-warning text-xs mt-0.5">{row.reason}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
            <p className="font-semibold mb-1">Resumo da importacao</p>
            <div className="flex flex-wrap gap-4 text-xs">
              <span className="text-success">Criar: <strong>{preview.summary.create}</strong></span>
              <span className="text-primary">Atualizar: <strong>{preview.summary.update}</strong></span>
              <span className="text-muted-foreground">Ignorar: <strong>{preview.summary.ignore}</strong></span>
              <span>Total itens: <strong>{preview.summary.itemsRead}</strong></span>
              <span>Valor: <strong>{money(preview.summary.totalCents)}</strong></span>
            </div>
            {preview.warnings.length > 0 && (
              <div className="mt-2 text-warning text-xs">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {preview.warnings.join('; ')}
              </div>
            )}
            {preview.errors.length > 0 && (
              <div className="mt-2 text-destructive text-xs">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {preview.errors.map((e) => `Linha ${e.line}: ${e.reason}`).join('; ')}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setStep('upload')}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Trocar arquivo
            </Button>
            <Button variant="outline" onClick={() => onClose()}>
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedLines.size === 0}
            >
              Confirmar importacao
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Formulario de produto ---------------- */

function ProductForm({
  open,
  product,
  categories,
  brands,
  suppliers,
  prefillBarcode,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: ProductDTO | null;
  categories: LookupOption[];
  brands: LookupOption[];
  suppliers: LookupOption[];
  /** Codigo lido antes de abrir o formulario (cadastro a partir de busca). */
  prefillBarcode: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [barcodeWarning, setBarcodeWarning] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? api.patch(`/api/products/${product.id}`, payload)
        : api.post('/api/products', payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Produto atualizado.' : 'Produto cadastrado.');
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar.'),
  });

  // Preenchimento ao abrir o formulario.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBarcodeWarning(null);
    if (isEdit && product) {
      setValues({
        name: product.name,
        barcode: product.barcode ?? '',
        internalCode: product.internalCode ?? '',
description: product.description ?? '',
        categoryId: product.categoryId ? String(product.categoryId) : '',
        brandId: product.brandId ? String(product.brandId) : '',
        supplierId: product.supplierId ? String(product.supplierId) : '',
        location: product.location ?? '',
        costPrice: (product.costPrice / 100).toFixed(2).replace('.', ','),
        salePrice: (product.salePrice / 100).toFixed(2).replace('.', ','),
        stock: String(product.stock),
        minStock: String(product.minStock),
        maxStock: product.maxStock ? String(product.maxStock) : '',
        unit: product.unit,
      });
    } else {
      setValues({
        name: '',
        barcode: prefillBarcode ?? '',
        internalCode: '',
        description: '',
        categoryId: '',
        brandId: '',
        supplierId: '',
        location: '',
        costPrice: '',
        salePrice: '',
        stock: '0',
        // Vazio de proposito: o servidor aplica o padrao configurado.
        minStock: '',
        maxStock: '',
        unit: 'UN',
      });
    }
  }, [open, product?.id]);

  const set = (key: string, value: string) =>
setValues((current) => ({ ...current, [key]: value }));

  const costCents = parseMoneyToCents(values.costPrice) ?? 0;
  const priceCents = parseMoneyToCents(values.salePrice) ?? 0;
  const margin = marginFromPrice(priceCents, costCents);
  const profit = priceCents - costCents;
  const [suggestPercent, setSuggestPercent] = useState('50');

  /**
   * Aplica um percentual ao custo e escreve o preco de venda resultante.
   * Markup incide sobre o custo, margem sobre o preco de venda: o resultado
   * muda conforme a base, e o operador escolhe qual das duas esta usando.
   */
  const setSalePriceBy = (basis: 'markup' | 'margin') => {
    const percentValue = Number(suggestPercent.replace(',', '.'));
    if (!Number.isFinite(percentValue) || costCents <= 0) return;
    const cents =
      basis === 'markup'
        ? priceFromMarkup(costCents, percentValue)
        : priceFromMargin(costCents, percentValue);
    if (cents <= 0) {
      setError('Percentual invalido para o custo informado.');
      return;
    }
    setError(null);
    set('salePrice', (cents / 100).toFixed(2).replace('.', ','));
};

  const onBarcodeChange = (value: string) => {
    const clean = normalizeBarcode(value);
    set('barcode', clean);
    setBarcodeWarning(
      clean.length > 0 && !isValidCheckDigit(clean)
        ? 'Atencao: o digito verificador deste codigo parece invalido.'
        : null,
    );
  };

  // Leitura com o formulario aberto: preenche o campo. Um unico contexto
  // cobre criacao e edicao - o `code` ja vem normalizado pelo manager.
  useBarcodeHandler(
    'PRODUCT_FORM',
    (result) => {
      set('barcode', result.code);
      setBarcodeWarning(
        !isValidCheckDigit(result.code)
          ? 'Atencao: o digito verificador deste codigo parece invalido.'
          : null,
      );
      toast.info(
        isEdit ? 'Codigo de barras atualizado pelo leitor' : 'Codigo de barras preenchido pelo leitor',
        { description: result.code },
      );
    },
    open,
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const cost = parseMoneyToCents(values.costPrice);
    const price = parseMoneyToCents(values.salePrice);
    if (cost === null) return setError('Informe um custo valido.');
    if (price === null) return setError('Informe um preco de venda valido.');
    if (cost < 0 || price < 0) return setError('Os valores nao podem ser negativos.');

    const payload: Record<string, unknown> = {
      name: values.name?.trim(),
      barcode: values.barcode?.trim() || undefined,
      internalCode: values.internalCode?.trim() || undefined,
description: values.description?.trim() || undefined,
        categoryId: values.categoryId ? Number(values.categoryId) : undefined,
      brandId: values.brandId ? Number(values.brandId) : undefined,
      supplierId: values.supplierId ? Number(values.supplierId) : undefined,
      location: values.location?.trim() || undefined,
      costPrice: cost,
      salePrice: price,
stock: Number(values.stock || 0),
      // Em branco = usa o estoque minimo padrao das configuracoes. Mandar 0
      // fixo sobrescreveria a regra do administrador com "sem alerta".
      minStock: !values.minStock?.trim() ? undefined : Number(values.minStock),
      maxStock: values.maxStock ? Number(values.maxStock) : undefined,
      unit: values.unit || 'UN',
      active: true,
    };

    if (!payload.name || String(payload.name).length < 2) {
      return setError('Informe o nome do produto (minimo 2 caracteres).');
    }

    mutation.mutate(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar: ${product?.name}` : 'Novo produto'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {isEdit ? 'Salvar alteracoes' : 'Cadastrar produto'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <FormError>{error}</FormError>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do produto" htmlFor="p-name" required className="sm:col-span-2">
            <Input
              id="p-name"
              value={values.name ?? ''}
              onChange={(event) => set('name', event.target.value)}
              placeholder="Ex.: Cerveja Long Neck 355ml"
              autoFocus
            />
</Field>

          <Field
            label="Codigo de barras"
            htmlFor="p-barcode"
            hint={barcodeWarning ?? 'Deixe vazio se o produto nao tiver codigo.'}
            error={barcodeWarning ?? undefined}
          >
            <Input
              id="p-barcode"
              value={values.barcode ?? ''}
              onChange={(event) => onBarcodeChange(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              // Digitar e pressionar Enter no campo manual percorre o mesmo
              // caminho do leitor fisico.
              data-barcode-input
            />
          </Field>

          <Field label="Codigo interno" htmlFor="p-internal">
            <Input
              id="p-internal"
              value={values.internalCode ?? ''}
              onChange={(event) => set('internalCode', event.target.value)}
              placeholder="Opcional"
            />
          </Field>

          <Field label="Categoria" htmlFor="p-category">
            <Select
              id="p-category"
              value={values.categoryId ?? ''}
              onChange={(event) => set('categoryId', event.target.value)}
            >
              <option value="">Sem categoria</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
</Field>

          <Field label="Marca" htmlFor="p-brand">
            <Select
              id="p-brand"
              value={values.brandId ?? ''}
              onChange={(event) => set('brandId', event.target.value)}
            >
              <option value="">Sem marca</option>
              {brands.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Fornecedor"
            htmlFor="p-supplier"
            hint={suppliers.length === 0 ? 'Nenhum fornecedor cadastrado ainda.' : undefined}
          >
            <Select
              id="p-supplier"
              value={values.supplierId ?? ''}
              onChange={(event) => set('supplierId', event.target.value)}
              disabled={suppliers.length === 0}
            >
              <option value="">Sem fornecedor</option>
              {suppliers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Localizacao"
            htmlFor="p-location"
            hint="Corredor/prateleira. Ajuda a Picking e a contagem fisica."
          >
            <Input
              id="p-location"
              value={values.location ?? ''}
              onChange={(event) => set('location', event.target.value)}
              placeholder="Ex.: Corredor 3, Prateleira B"
              maxLength={60}
            />
          </Field>

          {/* Precificacao */}
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Precificacao
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Custo unitario" htmlFor="p-cost" required>
                <Input
                  id="p-cost"
                  value={values.costPrice ?? ''}
                  onChange={(event) => set('costPrice', event.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </Field>
              <Field label="Preco de venda" htmlFor="p-price" required>
                <Input
                  id="p-price"
                  value={values.salePrice ?? ''}
                  onChange={(event) => set('salePrice', event.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </Field>
              <Field label="Unidade" htmlFor="p-unit">
                <Select
                  id="p-unit"
                  value={values.unit ?? 'UN'}
                  onChange={(event) => set('unit', event.target.value)}
                >
                  {PRODUCT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* Estoque */}
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estoque
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Estoque atual"
                htmlFor="p-stock"
                hint={isEdit ? 'Use Movimentacoes para alterar o estoque de produtos ja cadastrados.' : undefined}
              >
                <Input
                  id="p-stock"
                  type="number"
                  min={0}
                  value={values.stock ?? '0'}
                  onChange={(event) => set('stock', event.target.value)}
                  disabled={isEdit}
                />
              </Field>
<Field
                label="Estoque minimo"
                htmlFor="p-min"
                hint="Dispara o alerta de reposicao. Em branco usa o padrao das configuracoes."
              >
                <Input
                  id="p-min"
                  type="number"
                  min={0}
                  value={values.minStock ?? ''}
                  onChange={(event) => set('minStock', event.target.value)}
                />
              </Field>
              <Field label="Estoque maximo" htmlFor="p-max" hint="Opcional.">
                <Input
                  id="p-max"
                  type="number"
                  min={0}
                  value={values.maxStock ?? ''}
                  onChange={(event) => set('maxStock', event.target.value)}
                />
              </Field>
            </div>
          </div>

          <Field label="Descricao" htmlFor="p-desc" className="sm:col-span-2">
            <Textarea
              id="p-desc"
              value={values.description ?? ''}
              onChange={(event) => set('description', event.target.value)}
              placeholder="Informacoes adicionais, embalagem, observacoes..."
            />
          </Field>
        </div>

        {/* Resultado do preco */}
        {costCents > 0 && priceCents > 0 && (
          <div className="rounded-md border border-border bg-muted p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resultado
            </p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Lucro por unidade</p>
                <p
                  className={
                    profit < 0 ? 'font-bold tabular-nums text-destructive' : 'font-bold tabular-nums text-success'
                  }
                >
                  {money(profit)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Margem sobre venda</p>
<p className="font-bold tabular-nums">{percent(margin)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Markup sobre custo</p>
                <p className="font-bold tabular-nums">
                  {costCents > 0 ? percent((profit / costCents) * 100) : '-'}
                </p>
              </div>
              <div className="col-span-3 text-xs text-muted-foreground sm:col-span-1">
                <p>
                  Margem e o lucro sobre o <strong>preco de venda</strong>; markup e o lucro
                  sobre o <strong>custo</strong>. O mesmo resultado aparece como 50% ou
                  100% conforme a base escolhida.
                </p>
              </div>
            </div>

{/* Atalhos de calculo */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="self-center text-muted-foreground">Sugest rapida:</span>
              <input
                type="number"
                step="any"
                value={suggestPercent}
                onChange={(event) => setSuggestPercent(event.target.value)}
                aria-label="Percentual aplicado ao custo"
                className="w-16 rounded border border-input bg-background px-1.5 py-1 text-right tabular-nums"
              />
              <button
                type="button"
                onClick={() => setSalePriceBy('markup')}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Aplicar markup
              </button>
              <button
                type="button"
                onClick={() => setSalePriceBy('margin')}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Aplicar margem
              </button>
              <button
                type="button"
                onClick={() => set('salePrice', (priceFromMarkup(costCents, 50) / 100).toFixed(2).replace('.', ','))}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Markup 50%
              </button>
              <button
                type="button"
                onClick={() => set('salePrice', (priceFromMarkup(costCents, 100) / 100).toFixed(2).replace('.', ','))}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Markup 100%
              </button>
              <button
                type="button"
                onClick={() => set('salePrice', (priceFromMargin(costCents, 30) / 100).toFixed(2).replace('.', ','))}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Margem 30%
              </button>
              <button
                type="button"
                onClick={() => set('salePrice', (priceFromMargin(costCents, 40) / 100).toFixed(2).replace('.', ','))}
                className="rounded border border-input px-2 py-1 hover:bg-card"
              >
                Margem 40%
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}