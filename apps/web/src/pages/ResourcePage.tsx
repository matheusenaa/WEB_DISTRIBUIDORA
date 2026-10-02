import type { Permission } from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { Field, FormError, Input, SearchInput, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useDebounced } from '@/lib/useOnline';


/**
 * Pagina de cadastro generica (CRUD), usada por categorias, marcas,
 * fornecedores e clientes. Todos esses recursos tem o mesmo formato
 * de API: GET / paginado, POST, PATCH /:id e DELETE /:id.
 */

export interface FieldSpec {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'email' | 'tel';
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** So exibido no formulario de edicao. */
  editOnly?: boolean;
  full?: boolean;
}

export interface ResourceConfig<T> {
  path: string;
  title: string;
  description: string;
  icon: typeof Tag;
  canManage: Permission;
  fields: FieldSpec[];
  /** Extrai o valor principal da linha (nome). */
  primary: (row: T) => string;
  /** Documentos exibidos ao lado do nome. */
  secondary?: (row: T) => React.ReactNode;
  extraColumns?: Column<T>[];
  /** Transformacao antes de enviar no POST/PATCH. */
  toPayload?: (values: Record<string, unknown>) => Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

interface ResourceRow {
  id: number;
  name: string;
  active: boolean;
  productCount?: number;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  description?: string | null;
  createdAt?: string;
}

export function ResourcePage<T extends ResourceRow>({ config }: { config: ResourceConfig<T> }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const debouncedSearch = useDebounced(search, 350);

  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);

  const listQuery = useQuery({
    queryKey: ['resource', config.path, page, debouncedSearch, showInactive],
    queryFn: () =>
      api.get<{ data: T[]; pagination: { page: number; totalPages: number; total: number } }>(
        config.path,
        {
          page,
          perPage: 25,
          q: debouncedSearch || undefined,
          active: showInactive ? undefined : true,
        },
      ),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['resource', config.path] });

  const removeMutation = useMutation({
    mutationFn: (row: T) => api.delete(`${config.path}/${row.id}`),
    onSuccess: () => {
      toast.success('Registro excluido.');
      setDeleting(null);
      void invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel excluir.'),
  });

  const columns = useMemo<Column<T>[]>(() => {
    const base: Column<T>[] = [
      {
        key: 'name',
        header: 'Nome',
        render: (row) => (
          <div>
            <p className="font-medium">{config.primary(row)}</p>
            {config.secondary?.(row) && (
              <p className="text-xs text-muted-foreground">{config.secondary(row)}</p>
            )}
          </div>
        ),
      },
      {
        key: 'active',
        header: 'Situacao',
        className: 'w-28',
        render: (row) => (
          <Badge tone={row.active ? 'success' : 'muted'}>
            {row.active ? 'Ativo' : 'Inativo'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-40',
        render: (row) => (
          <RowActions
            onEdit={() => {
              setEditing(row);
              setFormOpen(true);
            }}
            onDelete={() => setDeleting(row)}
          />
        ),
      },
    ];
    return [...base, ...(config.extraColumns ?? [])];
  }, [config]);

const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <config.icon className="h-5 w-5 text-accent" aria-hidden />
            {config.title}
          </h1>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          Novo
        </Button>
      </div>

      <Card>
        <CardHeader
          title={config.title}
          description={`${listQuery.data?.pagination.total ?? 0} registro(s)`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
                />
                Mostrar inativos
              </label>
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar..."
                className="w-48"
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
                title={`Nenhum registro em ${config.title.toLowerCase()}`}
                description="Cadastre o primeiro item para comecar."
                icon={<config.icon className="h-8 w-8" aria-hidden />}
                action={
                  <Button onClick={openCreate} size="sm">
                    <Plus className="h-4 w-4" aria-hidden />
                    Cadastrar
                  </Button>
                }
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

      <ResourceForm
        config={config}
        open={formOpen}
        row={editing}
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
        title="Excluir registro"
        confirmLabel="Excluir"
        message={
          <>
            Tem certeza que deseja excluir <strong>{deleting ? config.primary(deleting) : ''}</strong>?
            <br />
            <span className="text-muted-foreground">
              A operacao nao pode ser desfeita. Se o registro ja foi usado em vendas, considere
              desativar em vez de excluir.
            </span>
          </>
        }
      />
    </div>
  );
}

/* ---------------- Formulario ---------------- */

function ResourceForm<T extends ResourceRow>({
  config,
  open,
  row,
  onClose,
  onSaved,
}: {
  config: ResourceConfig<T>;
  open: boolean;
  row: T | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      row ? api.patch(`${config.path}/${row.id}`, payload) : api.post(config.path, payload),
    onSuccess: () => {
      toast.success(row ? 'Registro atualizado.' : 'Registro criado.');
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar.'),
  });

  const isEdit = row !== null;

  // Preenche os valores quando o formulario abre.
  useEffect(() => {
    if (!open) return;
    const seed: Record<string, unknown> = { ...(config.defaults ?? { active: true }) };
    if (row) {
      for (const field of config.fields) {
        seed[field.name] = (row as Record<string, unknown>)[field.name] ?? '';
      }
    }
    setValues(seed);
    setError(null);
    // `config` e estavel: vem da definicao da pagina, fora do componente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const setValue = (name: string, value: unknown) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Remove campos vazios: a API trata `''` como "nao informado".
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value === '') continue;
      payload[key] = value;
    }
    if (config.toPayload) {
      Object.assign(payload, config.toPayload(payload));
    }

    const missing = config.fields.find(
      (field) => field.required && !payload[field.name] && payload[field.name] !== 0,
    );
    if (missing) {
      setError(`Informe "${missing.label}".`);
      return;
    }

    mutation.mutate(payload);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar ${config.title.toLowerCase().replace(/s$/, '')}` : `Novo registro em ${config.title.toLowerCase()}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            {isEdit ? 'Salvar alteracoes' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <FormError>{error}</FormError>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {config.fields.map((field) => {
            const value = String(values[field.name] ?? '');
            const controlProps = {
              id: field.name,
              value,
              required: field.required,
              placeholder: field.placeholder,
            };
            return (
              <Field
                key={field.name}
                label={field.label}
                htmlFor={field.name}
                required={field.required}
                hint={field.hint}
                className={field.full ? 'sm:col-span-2' : undefined}
              >
                {field.type === 'textarea' ? (
                  <Textarea
                    {...controlProps}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  />
                ) : (
                  <Input
                    {...controlProps}
                    type={field.type ?? 'text'}
                    onChange={(event) => setValue(field.name, event.target.value)}
                  />
                )}
              </Field>
            );
          })}

          <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(values.active)}
              onChange={(event) => setValue('active', event.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--accent))]"
            />
            <span className="text-sm">Registro ativo</span>
          </label>
        </div>
      </form>
    </Modal>
  );
}

/** Botoes de acao compartilhados nas colunas de listagem. */
export function RowActions({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Editar"
        title="Editar"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label="Excluir"
        title="Excluir"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}