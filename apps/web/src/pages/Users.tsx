import { ROLES, ROLE_LABELS } from '@webdist/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Shield, UserCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import { useDebounced } from '@/lib/useOnline';
import { initials, relative } from '@/lib/format';

interface UserRow {
  id: number;
  name: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'VENDEDOR';
  status: 'ATIVO' | 'BLOQUEADO';
  lastAccessAt: string | null;
  createdAt: string;
}

const PERMISSION_GROUPS: { label: string; items: { key: string; label: string }[] }[] = [
  {
    label: 'Usuarios',
    items: [
      { key: 'users:read', label: 'Ver usuarios' },
      { key: 'users:create', label: 'Criar usuarios' },
      { key: 'users:update', label: 'Editar usuarios' },
      { key: 'users:delete', label: 'Excluir usuarios' },
    ],
  },
  {
    label: 'Catalogo',
    items: [
      { key: 'products:read', label: 'Ver produtos' },
      { key: 'products:create', label: 'Criar produtos' },
      { key: 'products:update', label: 'Editar produtos' },
      { key: 'products:delete', label: 'Excluir produtos' },
      { key: 'categories:manage', label: 'Gerenciar categorias' },
      { key: 'brands:manage', label: 'Gerenciar marcas' },
      { key: 'suppliers:manage', label: 'Gerenciar fornecedores' },
      { key: 'customers:manage', label: 'Gerenciar clientes' },
    ],
  },
  {
    label: 'Estoque',
    items: [
      { key: 'stock:read', label: 'Ver estoque' },
      { key: 'stock:adjust', label: 'Ajustar estoque' },
      { key: 'stock:receive', label: 'Registrar entradas e saidas' },
    ],
  },
  {
    label: 'Vendas',
    items: [
      { key: 'sales:read', label: 'Ver as proprias vendas' },
      { key: 'sales:read-all', label: 'Ver todas as vendas' },
      { key: 'sales:create', label: 'Registrar vendas' },
      { key: 'sales:cancel', label: 'Cancelar vendas' },
    ],
  },
  {
    label: 'Caixa',
    items: [
      { key: 'cash:open', label: 'Abrir caixa' },
      { key: 'cash:close', label: 'Fechar caixa' },
      { key: 'cash:read', label: 'Ver caixa' },
      { key: 'cash:withdraw', label: 'Registrar entradas e saidas' },
    ],
  },
  {
    label: 'Analise',
    items: [
      { key: 'reports:read', label: 'Ver relatorios' },
      { key: 'dashboard:read', label: 'Ver dashboard' },
      { key: 'audit:read', label: 'Ver auditoria' },
    ],
  },
  {
    label: 'Administracao',
    items: [
      { key: 'settings:read', label: 'Ver configuracoes' },
      { key: 'settings:manage', label: 'Alterar configuracoes' },
      { key: 'logs:read', label: 'Ver logs do sistema' },
    ],
  },
];

export function UsersPage() {
  const { user: currentUser, can } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const debouncedSearch = useDebounced(search, 350);

  const listQuery = useQuery({
    queryKey: ['users', page, debouncedSearch, role, status],
    queryFn: () =>
      api.get<{ data: UserRow[]; pagination: { page: number; totalPages: number; total: number } }>(
        '/api/users',
        { page, perPage: 25, search: debouncedSearch || undefined, role: role || undefined, status: status || undefined },
      ),
  });

  const statusMutation = useMutation({
    mutationFn: ({ row, next }: { row: UserRow; next: 'ATIVO' | 'BLOQUEADO' }) =>
      api.post(`/api/users/${row.id}/status`, { status: next }),
    onSuccess: () => {
      toast.success('Situacao do usuario atualizada.');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Nao foi possivel alterar.'),
  });

  const columns = useMemo<Column<UserRow>[]>(
    () => [
      {
        key: 'name',
        header: 'Usuario',
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
              {initials(row.name)}
            </div>
            <div className="min-w-0">
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">
                {row.username} · {row.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Perfil',
        className: 'w-40',
        render: (row) => (
          <Badge tone={row.role === 'ADMIN' ? 'accent' : 'muted'}>
            {row.role === 'ADMIN' ? <Shield className="mr-1 h-3 w-3" aria-hidden /> : null}
            {ROLE_LABELS[row.role]}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Situacao',
        className: 'w-28',
        render: (row) => (
          <Badge tone={row.status === 'ATIVO' ? 'success' : 'destructive'}>
            {row.status === 'ATIVO' ? 'Ativo' : 'Bloqueado'}
          </Badge>
        ),
      },
      {
        key: 'access',
        header: 'Ultimo acesso',
        className: 'w-44',
        render: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.lastAccessAt ? relative(row.lastAccessAt) : 'nunca'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-56',
        render: (row) => (
          <div className="flex justify-end gap-1">
            {can('users:update') && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(row);
                    setFormOpen(true);
                  }}
                  className="rounded border border-input px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => setResetting(row)}
                  className="rounded border border-input px-2 py-1 text-xs font-medium hover:bg-muted"
                  title="Redefinir senha"
                >
                  Senha
                </button>
                {row.id !== currentUser?.id && (
                  <button
                    type="button"
                    onClick={() =>
                      statusMutation.mutate({
                        row,
                        next: row.status === 'ATIVO' ? 'BLOQUEADO' : 'ATIVO',
                      })
                    }
                    className="rounded border border-input px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    {row.status === 'ATIVO' ? 'Bloquear' : 'Ativar'}
                  </button>
                )}
              </>
            )}
          </div>
        ),
      },
    ],
    [can, currentUser?.id, statusMutation],
  );

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <UserCog className="h-5 w-5 text-accent" aria-hidden />
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground">
            {listQuery.data?.pagination.total ?? 0} conta(s) de acesso
          </p>
        </div>
        {can('users:create') && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo usuario
          </Button>
        )}
      </div>

      <Card>
        <CardHeader
          title="Contas"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Nome, usuario ou e-mail"
                className="w-56"
              />
              <Select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value);
                  setPage(1);
                }}
                className="w-40"
                aria-label="Filtrar por perfil"
              >
                <option value="">Todos os perfis</option>
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="w-36"
                aria-label="Filtrar por situacao"
              >
                <option value="">Todas</option>
                <option value="ATIVO">Ativos</option>
                <option value="BLOQUEADO">Bloqueados</option>
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
            emptyState={<EmptyState title="Nenhum usuario encontrado" icon={<UserCog className="h-8 w-8" aria-hidden />} />}
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

      <UserForm
        open={formOpen}
        user={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['users'] });
        }}
      />
      <ResetPasswordModal
        user={resetting}
        onClose={() => setResetting(null)}
        onSaved={() => setResetting(null)}
      />
    </div>
  );
}

/* ---------------- Formulario ---------------- */

function UserForm({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'VENDEDOR'>('VENDEDOR');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEdit = user !== null;
  const currentId = user?.id ?? 0;

  // Preenche os campos ao abrir o formulario.
  useEffect(() => {
    if (!open) return;
    setName(user?.name ?? '');
    setUsername(user?.username ?? '');
    setEmail(user?.email ?? '');
    setRole(user?.role ?? 'VENDEDOR');
    setPassword('');
    setConfirm('');
    setError(null);
  }, [open, currentId]);

  const submit = async () => {
    setError(null);
    if (name.trim().length < 3) return setError('Informe o nome completo.');
    if (!isEdit && username.trim().length < 3) return setError('Informe um usuario com ao menos 3 caracteres.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Informe um e-mail valido.');
    if (!isEdit) {
      if (password.length < 8) return setError('A senha deve ter ao menos 8 caracteres.');
      if (password !== confirm) return setError('As senhas nao conferem.');
    }

    setLoading(true);
    try {
      if (isEdit) {
        await api.patch(`/api/users/${user.id}`, { name: name.trim(), email: email.trim(), role });
      } else {
        await api.post('/api/users', {
          name: name.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim(),
          role,
          password,
        });
      }
      toast.success(isEdit ? 'Usuario atualizado.' : 'Usuario criado.');
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Editar: ${user?.name}` : 'Novo usuario'}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={loading}>
            {isEdit ? 'Salvar' : 'Criar usuario'}
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

        <Field label="Nome completo" htmlFor="u-name" required>
          <Input id="u-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
<Field
            label="Usuario (login)"
            htmlFor="u-username"
            required
            hint={isEdit ? 'Nao pode ser alterado.' : 'Usado para entrar no sistema.'}
          >
            <Input
              id="u-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={isEdit}
              autoCapitalize="none"
              className={isEdit ? 'opacity-60' : undefined}
            />
          </Field>
          <Field label="Perfil" htmlFor="u-role" required>
            <Select
              id="u-role"
              value={role}
              onChange={(event) => setRole(event.target.value as 'ADMIN' | 'VENDEDOR')}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="E-mail" htmlFor="u-email" required>
          <Input id="u-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>

        {!isEdit && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Senha" htmlFor="u-password" required hint="Minimo de 8 caracteres.">
              <Input
                id="u-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirmar senha" htmlFor="u-confirm" required>
              <Input
                id="u-confirm"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
        )}

        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-1.5 font-semibold">
            {role === 'ADMIN' ? 'Administrador pode:' : 'Vendedor pode:'}
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {PERMISSION_GROUPS.flatMap((group) => group.items)
              .filter((item) =>
                role === 'ADMIN' ? true : VENDEDOR_ALLOWED.includes(item.key),
              )
              .slice(0, 8)
              .map((item) => (
                <li key={item.key}>- {item.label}</li>
              ))}
            <li className="text-muted-foreground/70">
              (+ as demais permissoes definidas para o perfil)
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** Espelho das permissoes do vendedor, apenas para exibicao na tela. */
const VENDEDOR_ALLOWED = [
  'products:read',
  'categories:read',
  'brands:read',
  'suppliers:read',
  'customers:read',
  'customers:manage',
  'stock:read',
  'sales:read',
  'sales:create',
  'cash:open',
  'cash:close',
  'cash:read',
  'cash:withdraw',
  'dashboard:read',
];

/* ---------------- Redefinir senha ---------------- */

function ResetPasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!user) return null;

  const submit = async () => {
    setError(null);
    if (password.length < 8) return setError('A senha deve ter ao menos 8 caracteres.');
    if (password !== confirm) return setError('As senhas nao conferem.');
    setLoading(true);
    try {
await api.patch(`/api/users/${user.id}`, { password });
      toast.success('Senha redefinida.', {
        description: `Informe a nova senha para ${user.name}. As sessoes ativas foram encerradas.`,
      });
      setPassword('');
      setConfirm('');
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel redefinir.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Redefinir senha de ${user.name}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={loading}>
            <KeyRound className="h-4 w-4" aria-hidden />
            Redefinir
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
        <p className="text-sm text-muted-foreground">
          Informe a nova senha e oriente o usuario a troca-la no primeiro acesso.
        </p>
        <Field label="Nova senha" htmlFor="rp-password" required>
          <Input
            id="rp-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <Field label="Confirmar nova senha" htmlFor="rp-confirm" required>
          <Input
            id="rp-confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </Modal>
  );
}