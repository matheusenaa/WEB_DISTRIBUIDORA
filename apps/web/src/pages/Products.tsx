import { PRODUCT_UNITS, STOCK_ALERT_LABELS, type ProductDTO } from '@webdist/shared';
import { marginFromPrice, parseMoneyToCents, priceFromMargin, priceFromMarkup } from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Download, Package, Plus, Upload } from 'lucide-react';
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
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/input';
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
  const [deleting, setDeleting] = useState<ProductDTO | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
        toast.info('Buscando produto por codigo de barras', { description: result.code });
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
            Importar
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
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
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
    </div>
  );
}

/* ---------------- Formulario de produto ---------------- */

function ProductForm({
  open,
  product,
  categories,
  brands,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: ProductDTO | null;
  categories: LookupOption[];
  brands: LookupOption[];
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
        barcode: '',
        internalCode: '',
        description: '',
        categoryId: '',
        brandId: '',
        costPrice: '',
        salePrice: '',
        stock: '0',
        minStock: '0',
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
      costPrice: cost,
      salePrice: price,
      stock: Number(values.stock || 0),
      minStock: Number(values.minStock || 0),
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
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
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
              <Field label="Estoque minimo" htmlFor="p-min" hint="Dispara o alerta de reposicao.">
                <Input
                  id="p-min"
                  type="number"
                  min={0}
                  value={values.minStock ?? '0'}
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
            </div>

            {/* Atalhos de calculo */}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="self-center text-muted-foreground">Sugest rapida:</span>
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