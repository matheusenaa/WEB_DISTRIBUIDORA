import { AUDIT_ACTIONS, type AuditLogDTO } from '@webdist/shared';
import { useQuery } from '@tanstack/react-query';
import { Eye, ScrollText } from 'lucide-react';
import { useState } from 'react';
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
import { Input, SearchInput, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useDebounced } from '@/lib/useOnline';
import { dateTime } from '@/lib/format';

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<AuditLogDTO | null>(null);

  const debouncedSearch = useDebounced(search, 350);

  const listQuery = useQuery({
    queryKey: ['audit', page, debouncedSearch, action, entity, from, to],
    queryFn: () =>
      api.get<{ data: AuditLogDTO[]; pagination: { page: number; totalPages: number; total: number } }>(
        '/api/audit',
        {
          page,
          perPage: 40,
          search: debouncedSearch || undefined,
          action: action || undefined,
          entity: entity || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      ),
  });

  const columns: Column<AuditLogDTO>[] = [
    {
      key: 'createdAt',
      header: 'Data/hora',
      className: 'whitespace-nowrap',
      render: (row) => <span className="text-muted-foreground">{dateTime(row.createdAt)}</span>,
    },
    {
      key: 'user',
      header: 'Usuario',
      className: 'w-48',
      render: (row) => <span className="font-medium">{row.userName ?? 'sistema'}</span>,
    },
    {
      key: 'action',
      header: 'Acao',
      className: 'w-36',
      render: (row) => (
        <Badge tone={actionTone(row.action)}>{row.action}</Badge>
      ),
    },
    {
      key: 'entity',
      header: 'Entidade',
      className: 'w-32',
      render: (row) =>
        row.entity ? (
          <span className="text-xs text-muted-foreground">
            {row.entity}
            {row.entityId ? ` #${row.entityId}` : ''}
          </span>
        ) : (
          '-'
        ),
    },
    {
      key: 'description',
      header: 'Descricao',
      render: (row) => <span className="text-sm">{row.description}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-16',
      render: (row) => (
        <button
          type="button"
          onClick={() => setDetail(row)}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Ver detalhes"
          aria-label="Ver detalhes da acao"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
        </button>
      ),
    },
  ];

  const rows = listQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ScrollText className="h-5 w-5 text-accent" aria-hidden />
          Auditoria
        </h1>
        <p className="text-sm text-muted-foreground">
          Rastro imutavel das operacoes realizadas no sistema
        </p>
      </div>

      <Card>
        <CardHeader
          title="Registros"
          description={`${listQuery.data?.pagination.total ?? 0} registro(s)`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Usuario ou descricao"
                className="w-48"
              />
              <Select
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                className="w-44"
                aria-label="Filtrar por acao"
              >
                <option value="">Todas as acoes</option>
                {AUDIT_ACTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              <Input
                value={entity}
                onChange={(event) => {
                  setEntity(event.target.value);
                  setPage(1);
                }}
                placeholder="Entidade"
                className="w-32"
                aria-label="Filtrar por entidade"
              />
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
                title="Nenhum registro de auditoria"
                description="As operacoes realizadas aparecem aqui automaticamente."
                icon={<ScrollText className="h-8 w-8" aria-hidden />}
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

      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={`Auditoria #${detail.id}`}
          size="lg"
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Data/hora</dt>
                <dd className="font-medium">{dateTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Usuario</dt>
                <dd className="font-medium">{detail.userName ?? 'sistema'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Acao</dt>
                <dd>
                  <Badge tone={actionTone(detail.action)}>{detail.action}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Entidade</dt>
                <dd className="font-medium">
                  {detail.entity ?? '-'}
                  {detail.entityId ? ` #${detail.entityId}` : ''}
                </dd>
              </div>
            </dl>

            <div>
              <p className="text-xs text-muted-foreground">Descricao</p>
              <p className="text-sm">{detail.description}</p>
            </div>

            {detail.ip && (
              <div>
                <p className="text-xs text-muted-foreground">Origem</p>
                <p className="font-mono text-xs">
                  {detail.ip}
                  {detail.userAgent ? ` - ${detail.userAgent}` : ''}
                </p>
              </div>
            )}

            {detail.before != null && (
              <JsonBlock title="Estado anterior" value={detail.before} />
            )}
            {detail.after != null && <JsonBlock title="Estado posterior" value={detail.after} />}
          </div>
        </Modal>
      )}
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function actionTone(action: string): 'default' | 'success' | 'warning' | 'destructive' | 'muted' {
  if (action.includes('DELETE') || action.includes('CANCEL') || action === 'LOGIN_FAILED') {
    return 'destructive';
  }
  if (action === 'LOGIN' || action === 'CREATE' || action === 'CASH_OPEN') return 'success';
  if (action === 'UPDATE' || action === 'STOCK_ADJUST' || action === 'PASSWORD_CHANGE') return 'warning';
  if (action === 'LOGOUT') return 'muted';
  return 'default';
}