import { CASH_EXIT_LABELS, type CashSessionDTO, type CashSessionDetailDTO } from '@webdist/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Lock, Unlock, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Modal,
  Pagination,
  Spinner,
} from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { parseMoneyToCents } from '@webdist/shared';
import { dateTime, integer, money } from '@/lib/format';

export function CashPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [openModal, setOpenModal] = useState(false);
  const [entryModal, setEntryModal] = useState(false);
  const [exitModal, setExitModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const currentQuery = useQuery({
    queryKey: ['cash', 'current'],
    queryFn: () =>
      api.get<{ session: CashSessionDetailDTO | null }>('/api/cash/current'),
    // O caixa muda a cada venda: manter atualizado.
    refetchInterval: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ['cash', 'sessions', historyPage],
    queryFn: () =>
      api.get<{
        data: CashSessionDTO[];
        pagination: { page: number; totalPages: number; total: number };
      }>('/api/cash/sessions', { page: historyPage, perPage: 15 }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const session = currentQuery.data?.session ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Wallet className="h-5 w-5 text-accent" aria-hidden />
            Caixa
          </h1>
          <p className="text-sm text-muted-foreground">
            Abertura, movimentos e fechamento com conferencia
          </p>
        </div>
        {session ? (
          <>
            {can('cash:withdraw') && (
              <>
                <Button variant="outline" onClick={() => setEntryModal(true)}>
                  <ArrowUpCircle className="h-4 w-4" aria-hidden />
                  Entrada
                </Button>
                <Button variant="outline" onClick={() => setExitModal(true)}>
                  <ArrowDownCircle className="h-4 w-4" aria-hidden />
                  Saida
                </Button>
              </>
            )}
            {can('cash:close') && (
              <Button variant="accent" onClick={() => setCloseModal(true)}>
                <Lock className="h-4 w-4" aria-hidden />
                Fechar caixa
              </Button>
            )}
          </>
        ) : (
          can('cash:open') && (
            <Button variant="accent" onClick={() => setOpenModal(true)}>
              <Unlock className="h-4 w-4" aria-hidden />
              Abrir caixa
            </Button>
          )
        )}
      </div>

      {currentQuery.isLoading && <Spinner />}

      {/* ---------------- Caixa aberto ---------------- */}
      {session ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader
              title={`Caixa #${session.id} - aberto`}
              description={`Aberto por ${session.userName} em ${dateTime(session.openedAt)}`}
              action={<Badge tone="success">ABERTO</Badge>}
            />
            <CardContent className="p-0">
              {session.movements.length === 0 ? (
                <EmptyState
                  title="Nenhum movimento ainda"
                  description="As vendas em dinheiro serao lancadas aqui automaticamente."
                  icon={<Wallet className="h-8 w-8" aria-hidden />}
                />
              ) : (
                <div className="max-h-[26rem] overflow-y-auto">
                  <table className="table-compact w-full">
                    <thead className="sticky top-0 bg-muted/95">
                      <tr>
                        <th>Data</th>
                        <th>Tipo</th>
                        <th>Descricao</th>
                        <th>Operador</th>
                        <th className="text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...session.movements].reverse().map((movement) => (
                        <tr key={movement.id}>
                          <td className="whitespace-nowrap text-muted-foreground">
                            {dateTime(movement.createdAt)}
                          </td>
                          <td>
                            <Badge tone={movement.type === 'ENTRADA' ? 'success' : 'destructive'}>
                              {movement.type === 'ENTRADA' ? 'Entrada' : 'Saida'}
                            </Badge>
                          </td>
                          <td>
                            <p>{movement.description}</p>
                            {movement.saleNumber && (
                              <p className="text-xs text-muted-foreground">
                                Venda #{movement.saleNumber}
                              </p>
                            )}
                          </td>
                          <td className="text-xs text-muted-foreground">{movement.userName}</td>
                          <td
                            className={`text-right font-semibold tabular-nums ${
                              movement.type === 'ENTRADA' ? 'text-success' : 'text-destructive'
                            }`}
                          >
                            {movement.type === 'ENTRADA' ? '+' : '-'}
                            {money(movement.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="lg:sticky lg:top-[4.5rem] lg:self-start">
            <Card>
              <CardContent className="space-y-3 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Conference
                </h3>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Valor inicial</dt>
                    <dd className="tabular-nums">{money(session.initialAmountCents)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Entradas</dt>
                    <dd className="tabular-nums text-success">
                      +{money(session.entriesTotalCents ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Saidas</dt>
                    <dd className="tabular-nums text-destructive">
                      -{money(session.exitsTotalCents ?? 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                    <dt>Esperado em caixa</dt>
                    <dd className="tabular-nums">{money(session.expectedAmountCents)}</dd>
                  </div>
                </dl>
                {can('cash:close') && (
                  <Button variant="accent" className="w-full" onClick={() => setCloseModal(true)}>
                    <Lock className="h-4 w-4" aria-hidden />
                    Fechar e conferir
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : !currentQuery.isLoading ? (
        <Card>
          <CardContent>
            <EmptyState
              title="Nenhum caixa aberto"
              description="Abra o caixa com o valor inicial em dinheiro para comecar a registrar as vendas do dia."
              icon={<Wallet className="h-8 w-8" aria-hidden />}
              action={
                can('cash:open') ? (
                  <Button onClick={() => setOpenModal(true)}>
                    <Unlock className="h-4 w-4" aria-hidden />
                    Abrir caixa
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Historico ---------------- */}
      <Card>
        <CardHeader title="Historico de caixas" />
        <CardContent className="p-0">
          {historyQuery.data?.data.length ? (
            <div className="overflow-x-auto">
              <table className="table-compact w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th>Abertura</th>
                    <th>Responsavel</th>
                    <th>Situacao</th>
                    <th className="text-right">Inicial</th>
                    <th className="text-right">Esperado</th>
                    <th className="text-right">Informado</th>
                    <th className="text-right">Diferenca</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.data.map((item) => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap">{dateTime(item.openedAt)}</td>
                      <td>{item.userName}</td>
                      <td>
                        <Badge tone={item.status === 'ABERTO' ? 'success' : 'muted'}>
                          {item.status === 'ABERTO' ? 'Aberto' : 'Fechado'}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">{money(item.initialAmountCents)}</td>
                      <td className="text-right tabular-nums">{money(item.expectedAmountCents)}</td>
                      <td className="text-right tabular-nums">
                        {item.reportedAmountCents === null ? '-' : money(item.reportedAmountCents)}
                      </td>
                      <td
                        className={`text-right font-semibold tabular-nums ${
                          (item.differenceCents ?? 0) === 0
                            ? 'text-success'
                            : (item.differenceCents ?? 0) > 0
                              ? 'text-warning'
                              : 'text-destructive'
                        }`}
                      >
                        {item.differenceCents === null ? '-' : money(item.differenceCents)}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSessionDetail(item.id)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nenhum caixa registrado" />
          )}
          {historyQuery.data && (
            <Pagination
              page={historyQuery.data.pagination.page}
              totalPages={historyQuery.data.pagination.totalPages}
              total={historyQuery.data.pagination.total}
              onPageChange={setHistoryPage}
            />
          )}
        </CardContent>
      </Card>

      {/* ---------------- Modais ---------------- */}
      <OpenCashModal open={openModal} onClose={() => setOpenModal(false)} onSaved={invalidate} />
      <EntryModal open={entryModal} onClose={() => setEntryModal(false)} onSaved={invalidate} />
      <ExitModal open={exitModal} onClose={() => setExitModal(false)} onSaved={invalidate} />
      <CloseModal
        open={closeModal}
        session={session}
        onClose={() => setCloseModal(false)}
        onSaved={invalidate}
      />
      <SessionDetailModal id={sessionDetail} onClose={() => setSessionDetail(null)} />
    </div>
  );
}

/* ---------------- Abrir caixa ---------------- */

function OpenCashModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cents = parseMoneyToCents(amount);

  const submit = async () => {
    setError(null);
    if (cents === null || cents < 0) {
      setError('Informe um valor inicial valido.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/cash/open', { initialAmountCents: cents, notes: notes.trim() || undefined });
      toast.success('Caixa aberto.');
      setAmount('');
      setNotes('');
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel abrir o caixa.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir caixa"
      description="Informe o valor em dinheiro que esta no caixa no inicio do turno."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={() => void submit()} loading={loading}>
            Abrir caixa
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
        <Field label="Valor inicial" htmlFor="cash-open" required hint="Ex.: 100 ou 100,50">
          <Input
            id="cash-open"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            autoFocus
            className="h-12 text-lg font-semibold tabular-nums"
          />
        </Field>
        <Field label="Observacao" htmlFor="cash-open-notes">
          <Textarea
            id="cash-open-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- Entrada ---------------- */

function EntryModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = parseMoneyToCents(amount);

  const submit = async () => {
    setError(null);
    if (cents === null || cents <= 0) return setError('Informe um valor maior que zero.');
    if (description.trim().length < 3) return setError('Descreva o motivo da entrada.');
    setLoading(true);
    try {
      await api.post('/api/cash/entries', {
        kind: 'OUTRA_ENTRADA',
        amountCents: cents,
        description: description.trim(),
      });
      toast.success('Entrada registrada.');
      setAmount('');
      setDescription('');
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
      title="Entrada manual no caixa"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="accent" onClick={() => void submit()} loading={loading}>
            Registrar entrada
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
          Use para entradas que nao vieram de vendas: troco recebido de fornecedor, aporte do
          proprietario, devolucao, etc.
        </p>
        <Field label="Valor" htmlFor="cash-entry-amount" required>
          <Input
            id="cash-entry-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            autoFocus
            className="h-12 text-lg font-semibold tabular-nums"
          />
        </Field>
        <Field label="Descricao" htmlFor="cash-entry-desc" required>
          <Input
            id="cash-entry-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: aporte do socio para caixa"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- Saida ---------------- */

function ExitModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<keyof typeof CASH_EXIT_LABELS>('DESPESA');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = parseMoneyToCents(amount);

  const submit = async () => {
    setError(null);
    if (cents === null || cents <= 0) return setError('Informe um valor maior que zero.');
    if (description.trim().length < 3) return setError('Descreva o motivo da saida.');
    setLoading(true);
    try {
      await api.post('/api/cash/exits', {
        kind,
        amountCents: cents,
        description: description.trim(),
      });
      toast.success('Saida registrada.');
      setAmount('');
      setDescription('');
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
      title="Saida do caixa"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => void submit()} loading={loading}>
            Registrar saida
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
        <Field label="Tipo de saida" htmlFor="cash-exit-kind" required>
          <Select
            id="cash-exit-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as keyof typeof CASH_EXIT_LABELS)}
          >
            {Object.entries(CASH_EXIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valor" htmlFor="cash-exit-amount" required>
          <Input
            id="cash-exit-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            autoFocus
            className="h-12 text-lg font-semibold tabular-nums"
          />
        </Field>
        <Field label="Descricao" htmlFor="cash-exit-desc" required>
          <Input
            id="cash-exit-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: pagamento do energia"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- Fechar ---------------- */

function CloseModal({
  open,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  session: CashSessionDetailDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open || !session) return null;

  const reported = parseMoneyToCents(amount);
  const expected = session.expectedAmountCents;
  const difference = reported === null ? null : reported - expected;

  const submit = async () => {
    setError(null);
    if (reported === null || reported < 0) return setError('Informe o valor total contado.');
    setLoading(true);
    try {
      const result = await api.post<{ differenceCents: number }>('/api/cash/close', {
        reportedAmountCents: reported,
        notes: notes.trim() || undefined,
      });
      if (result.differenceCents === 0) {
        toast.success('Caixa fechado sem diferenca.');
      } else {
        toast.warning(`Caixa fechado com diferenca de ${money(result.differenceCents)}.`, {
          description: 'O valor foi registrado e pode ser revisado na auditoria.',
        });
      }
      setAmount('');
      setNotes('');
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel fechar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fechar caixa"
      description="Informe o total de dinheiro contado na gaveta."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={loading}>
            Fechar caixa
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

        <dl className="space-y-1.5 rounded-md bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Valor inicial</dt>
            <dd className="tabular-nums">{money(session.initialAmountCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Entradas</dt>
            <dd className="tabular-nums text-success">
              +{money(session.entriesTotalCents ?? 0)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Saidas</dt>
            <dd className="tabular-nums text-destructive">-{money(session.exitsTotalCents ?? 0)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
            <dt>Esperado</dt>
            <dd className="tabular-nums">{money(expected)}</dd>
          </div>
        </dl>

        <Field label="Total contado na gaveta" htmlFor="cash-close" required>
          <Input
            id="cash-close"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder={ (expected / 100).toFixed(2).replace('.', ',') }
            autoFocus
            className="h-12 text-lg font-semibold tabular-nums"
          />
        </Field>

        {difference !== null && (
          <div
            className={`flex items-center justify-between rounded-md border p-3 text-sm ${
              difference === 0
                ? 'border-success/40 bg-success/10 text-success'
                : difference > 0
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            <span className="font-medium">
              {difference === 0 ? 'Caixa bate' : difference > 0 ? 'Sobra' : 'Falta'}
            </span>
            <span className="text-lg font-bold tabular-nums">{money(Math.abs(difference))}</span>
          </div>
        )}

        <Field
          label="Observacao"
          htmlFor="cash-close-notes"
          hint="Informe a justificativa quando houver diferenca."
        >
          <Textarea
            id="cash-close-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Opcional"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------------- Detalhe de sessao ---------------- */

function SessionDetailModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['cash', 'session', id],
    queryFn: () => api.get<CashSessionDetailDTO>(`/api/cash/sessions/${id}`),
    enabled: id !== null,
  });

  if (id === null) return null;

  return (
    <Modal open onClose={onClose} title={`Caixa #${id}`} size="lg">
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Responsavel</p>
              <p className="font-medium">{data.userName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Abertura</p>
              <p className="font-medium">{dateTime(data.openedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fechamento</p>
              <p className="font-medium">{data.closedAt ? dateTime(data.closedAt) : 'Em aberto'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Situacao</p>
              <p className="font-medium">
                {data.status === 'ABERTO' ? 'Aberto' : 'Fechado'}
              </p>
            </div>
          </dl>

          <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted p-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Inicial</dt>
              <dd className="tabular-nums">{money(data.initialAmountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Esperado</dt>
              <dd className="tabular-nums">{money(data.expectedAmountCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Informado</dt>
              <dd className="tabular-nums">
                {data.reportedAmountCents === null ? '-' : money(data.reportedAmountCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Diferenca</dt>
              <dd className="tabular-nums font-semibold">
                {data.differenceCents === null ? '-' : money(data.differenceCents)}
              </dd>
            </div>
          </dl>

          {data.notes && <p className="text-sm text-muted-foreground">Obs.: {data.notes}</p>}

          {data.movements.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              <table className="table-compact w-full">
                <thead className="sticky top-0 bg-muted/95">
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descricao</th>
                    <th className="text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((movement) => (
                    <tr key={movement.id}>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {dateTime(movement.createdAt)}
                      </td>
                      <td>
                        <Badge tone={movement.type === 'ENTRADA' ? 'success' : 'destructive'}>
                          {movement.type}
                        </Badge>
                      </td>
                      <td>{movement.description}</td>
                      <td className="text-right font-semibold tabular-nums">
                        {money(movement.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {integer(data.movements.length)} movimento(s) registrado(s).
          </p>
        </div>
      )}
    </Modal>
  );
}