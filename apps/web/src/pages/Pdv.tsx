import { PAYMENT_METHOD_LABELS, type SalePaymentMethod, type SalePaymentMethod as Method } from '@webdist/shared';
import { applyPercentDiscount, marginFromPrice, parseMoneyToCents } from '@webdist/shared';
import {
  AlertTriangle,
  Barcode,
  CreditCard,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader, EmptyState, Modal, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { normalizeBarcode, useBarcodeHandler, type ScanResult } from '@/lib/barcode/BarcodeManager';
import { cn } from '@/lib/cn';
import { money, qty } from '@/lib/format';

/* ---------------- Tipos ---------------- */

interface CartLine {
  productId: number;
  name: string;
  unit: string;
  barcode: string | null;
  unitPriceCents: number;
  costCents: number;
  stock: number;
  quantity: number;
  discountPercent: number;
}

interface FoundProduct {
  id: number;
  name: string;
  barcode: string | null;
  unit: string;
  salePrice: number;
  costPrice: number;
  stock: number;
}

const QUICK_KEYS = ['F2', 'F4', 'F8'] as const;

export function PdvPage() {
  const { user, can } = useAuth();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<FoundProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  /* ---------------- Totais ---------------- */

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    for (const line of lines) {
      const gross = line.unitPriceCents * line.quantity;
      subtotal += gross;
      discount += applyPercentDiscount(gross, line.discountPercent);
    }
    const total = subtotal - discount;
    // Custo proporcional ao preco, para o lucro nao depender do desconto
    // estar sempre no mesmo item.
    const cost = lines.reduce(
      (sum, line) =>
        sum +
        (line.unitPriceCents > 0
          ? Math.round(
              (applyPercentDiscount(line.unitPriceCents * line.quantity, line.discountPercent) /
                line.unitPriceCents) *
                line.costCents,
            )
          : line.costCents * line.quantity),
      0,
    );
    return {
      subtotal,
      discount,
      total,
      profit: total - cost,
      margin: marginFromPrice(total, cost),
      items: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }, [lines]);

  /* ---------------- Acoes de carrinho ---------------- */

  const addLine = useCallback((product: FoundProduct, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          barcode: product.barcode,
          unitPriceCents: product.salePrice,
          costCents: product.costPrice,
          stock: product.stock,
          quantity,
          discountPercent: 0,
        },
      ];
    });
  }, []);

  const changeQuantity = useCallback((productId: number, delta: number) => {
    setLines((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        // Linhas com quantidade zero saem do carrinho.
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const setLineQuantity = useCallback((productId: number, quantity: number) => {
    setLines((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.max(0, quantity) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const setLineDiscount = useCallback((productId: number, discount: number) => {
    setLines((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, discountPercent: Math.min(100, Math.max(0, discount)) }
          : line,
      ),
    );
  }, []);

  const removeLine = useCallback((productId: number) => {
    setLines((current) => current.filter((line) => line.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  /* ---------------- Busca ---------------- */

  /**
   * Adiciona ao carrinho. Aceita o produto parcial que o PDV usa, que e
   * um subconjunto do DTO completo devolvido pela API.
   */
  const addFoundProduct = useCallback(
    (code: string, product: FoundProduct | null) => {
      if (!product) {
        toast.error('Codigo de barras nao encontrado', {
          description: `Nenhum produto com o codigo ${code}`,
        });
        return;
      }
      if (product.stock <= 0) {
        toast.error(`${product.name} esta sem estoque.`);
        return;
      }
      addLine(product);
      toast.success(product.name, { description: 'Item adicionado ao carrinho' });
    },
    [addLine],
  );

  /** Leitor global: o manager ja consultou o produto, entao aqui so decidimos o que fazer. */
  const handleScanResult = useCallback(
    (result: ScanResult) => {
      addFoundProduct(result.code, result.product);
    },
    [addFoundProduct],
  );

  /** Busca por codigo, para digitacao manual e acoes de teclado. */
  const lookup = useCallback(
    async (rawCode: string) => {
      const code = normalizeBarcode(rawCode);
      if (!code) return;
      try {
        const response = await api.get<{ found: boolean; product: FoundProduct | null }>(
          `/api/products/barcode/${encodeURIComponent(code)}`,
        );
        addFoundProduct(code, response.product);
      } catch (error) {
        toast.error(
          error instanceof ApiError ? error.message : 'Falha ao consultar o codigo de barras.',
        );
      }
    },
    [addFoundProduct],
  );

  // Desregistrado durante o pagamento e o caixa para nao beepar produto
  // com o cupom aberto.
  useBarcodeHandler('PDV', handleScanResult, !paymentOpen && !cashOpen);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .get<{ data: FoundProduct[] }>('/api/products/search', { q: term, perPage: 8 })
        .then((result) => {
          if (!cancelled) setSearchResults(result.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  /* ---------------- Atalhos de teclado ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key;

      if (key === QUICK_KEYS[0]) {
        // F2: comeca uma nova venda.
        event.preventDefault();
        if (lines.length > 0 && !window.confirm('Descartar a venda atual e comecar outra?')) return;
        clearCart();
        setManualCode('');
        setSearchTerm('');
        searchInputRef.current?.focus();
        return;
      }

      if (key === QUICK_KEYS[1]) {
        // F4: abre o pagamento.
        if (lines.length === 0) {
          toast.error('Adicione itens antes de finalizar.');
          return;
        }
        event.preventDefault();
        setPaymentOpen(true);
        return;
      }

      if (key === QUICK_KEYS[2]) {
        // F8: limpa o carrinho.
        if (lines.length === 0) return;
        event.preventDefault();
        if (window.confirm('Remover todos os itens do carrinho?')) {
          clearCart();
          toast.info('Carrinho esvaziado.');
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length, clearCart]);

  const onManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const code = normalizeBarcode(manualCode);
    if (!code) return;
    void lookup(code);
    setManualCode('');
    searchInputRef.current?.focus();
  };

  return (
    <div className="space-y-4">
      {/* ---------------- Barra de acoes ---------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">Ponto de Venda</h1>
        <Badge tone="muted" className="gap-1">
          <User className="h-3 w-3" aria-hidden />
          {user?.name}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => setCashOpen(true)} title="F9">
          <CreditCard className="h-4 w-4" aria-hidden />
          Caixa
        </Button>
        <Button variant="outline" size="sm" onClick={clearCart} disabled={lines.length === 0}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Limpar
        </Button>
        <Button
          variant="accent"
          onClick={() => setPaymentOpen(true)}
          disabled={lines.length === 0 }
        >
          <ShoppingCart className="h-4 w-4" aria-hidden />
          Finalizar
          <kbd className="ml-1 hidden rounded bg-black/15 px-1 font-mono text-[10px] sm:inline">F4</kbd>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- Coluna esquerda: busca + itens ---------------- */}
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Leitor de codigo de barras */}
                <form onSubmit={onManualSubmit} className="space-y-1.5">
                  <label htmlFor="pdv-barcode" className="text-sm font-medium">
                    Codigo de barras
                  </label>
                  <div className="relative">
                    <ScanBarcode
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent"
                      aria-hidden
                    />
                    <Input
                      id="pdv-barcode"
                      value={manualCode}
                      onChange={(event) => setManualCode(event.target.value)}
                      placeholder="Bipe o leitor ou digite"
                      autoComplete="off"
                      inputMode="numeric"
                      className="h-12 pl-9 font-mono"
                      ref={searchInputRef}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O leitor funciona automaticamente, sem clicar aqui.
                  </p>
                </form>

                {/* Busca por nome */}
                <div className="space-y-1.5">
                  <label htmlFor="pdv-search" className="text-sm font-medium">
                    Buscar por nome
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="pdv-search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Digite ao menos 2 letras"
                      autoComplete="off"
                      className="h-12 pl-9"
                    />
                  </div>
                </div>
              </div>

              {/* Resultados da busca por nome */}
              {searchResults.length > 0 && (
                <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                  {searchResults.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (product.stock <= 0) {
                            toast.error(`${product.name} esta sem estoque.`);
                            return;
                          }
                          addLine(product);
                          setSearchTerm('');
                          searchInputRef.current?.focus();
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{product.name}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            {product.barcode && (
                              <span className="flex items-center gap-1 font-mono">
                                <Barcode className="h-3 w-3" aria-hidden />
                                {product.barcode}
                              </span>
                            )}
                            <span>Estoque: {qty(product.stock)}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold">
                          {money(product.salePrice)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {searching && searchResults.length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">Buscando...</p>
              )}
            </CardContent>
          </Card>

          {/* Itens do carrinho */}
          <Card>
            <CardHeader
              title="Itens da venda"
              description={
                lines.length === 0
                  ? 'Nenhum item adicionado'
                  : `${totals.items} ${totals.items === 1 ? 'item' : 'itens'} em ${lines.length} linha(s)`
              }
            />
            <CardContent className="p-0">
              {lines.length === 0 ? (
                <EmptyState
                  title="Carrinho vazio"
                  description="Bipe um codigo de barras ou busque um produto para comecar a venda."
                  icon={<ShoppingCart className="h-8 w-8" aria-hidden />}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-compact w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th>Produto</th>
                        <th className="w-32 text-center">Qtd</th>
                        <th className="w-24 text-right">Unit.</th>
                        <th className="w-24 text-right">Desc.</th>
                        <th className="w-28 text-right">Subtotal</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const gross = line.unitPriceCents * line.quantity;
                        const lineTotal = applyPercentDiscount(gross, line.discountPercent);
                        const exceeded = line.quantity > line.stock;
                        return (
                          <tr key={line.productId} className={exceeded ? 'bg-destructive/5' : undefined}>
                            <td>
                              <p className="font-medium">{line.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {line.barcode && <span className="font-mono">{line.barcode} - </span>}
                                Estoque: {qty(line.stock)} {line.unit}
                                {exceeded && (
                                  <span className="ml-1.5 font-semibold text-destructive">
                                    acima do estoque
                                  </span>
                                )}
                              </p>
                            </td>
                            <td>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => changeQuantity(line.productId, -1)}
                                  aria-label={`Diminuir ${line.name}`}
                                >
                                  <Minus className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={line.quantity}
                                  onChange={(event) =>
                                    setLineQuantity(line.productId, Number(event.target.value))
                                  }
                                  className="h-8 w-12 rounded border border-input bg-card text-center text-sm tabular-nums"
                                  aria-label={`Quantidade de ${line.name}`}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => changeQuantity(line.productId, 1)}
                                  aria-label={`Aumentar ${line.name}`}
                                >
                                  <Plus className="h-3.5 w-3.5" aria-hidden />
                                </Button>
                              </div>
                            </td>
                            <td className="text-right tabular-nums">{money(line.unitPriceCents)}</td>
                            <td className="text-right">
                              {can('sales:create') && (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.5"
                                  value={line.discountPercent}
                                  onChange={(event) =>
                                    setLineDiscount(line.productId, Number(event.target.value))
                                  }
                                  disabled={!can('sales:create')}
                                  placeholder="0"
                                  className="h-8 w-14 rounded border border-input bg-card px-1.5 text-right text-sm tabular-nums disabled:opacity-50"
                                  aria-label={`Desconto percentual de ${line.name}`}
                                />
                              )}
                            </td>
                            <td className="text-right font-semibold tabular-nums">{money(lineTotal)}</td>
                            <td>
                              <button
                                type="button"
                                onClick={() => removeLine(line.productId)}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Remover ${line.name}`}
                              >
                                <X className="h-4 w-4" aria-hidden />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ---------------- Coluna direita: totais ---------------- */}
        <div className="lg:sticky lg:top-[4.5rem] lg:self-start">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-80">Resumo</h2>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="opacity-80">Subtotal</dt>
                  <dd className="tabular-nums">{money(totals.subtotal)}</dd>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-accent-foreground">
                    <dt>Desconto</dt>
                    <dd className="tabular-nums">-{money(totals.discount)}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-primary-foreground/20 pt-2">
                  <dt className="text-base font-semibold">Total</dt>
                  <dd className="text-2xl font-bold tabular-nums">{money(totals.total)}</dd>
                </div>
                <div className="flex justify-between text-xs opacity-75">
                  <dt>Lucro estimado</dt>
                  <dd className="tabular-nums">
                    {money(totals.profit)} ({totals.margin.toFixed(1)}%)
                  </dd>
                </div>
              </dl>

              <Button
                variant="accent"
                size="xl"
                className="w-full"
                onClick={() => setPaymentOpen(true)}
                disabled={lines.length === 0 }
              >
                <ShoppingCart className="h-5 w-5" aria-hidden />
                Finalizar venda
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-primary-foreground hover:bg-primary-foreground/10"
                onClick={clearCart}
                disabled={lines.length === 0}
              >
                Esvaziar carrinho (F8)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---------------- Modais ---------------- */}
      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        totals={totals}
        lines={lines}
        onFinish={clearCart}
      />
      <QuickCashModal open={cashOpen} onClose={() => setCashOpen(false)} />
    </div>
  );
}

/* ---------------- Modal de pagamento ---------------- */

function PaymentModal({
  open,
  onClose,
  totals,
  lines,
  onFinish,
}: {
  open: boolean;
  onClose: () => void;
  totals: { subtotal: number; discount: number; total: number };
  lines: CartLine[];
  onFinish: () => void;
}) {
  const { can, user } = useAuth();

  const [method, setMethod] = useState<Method>('DINHEIRO');
  const [amountText, setAmountText] = useState('');
  const [customerId, setCustomerId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);


  const paidCents = parseMoneyToCents(amountText);
  const isCash = method === 'DINHEIRO';
  const changeCents = paidCents !== null && isCash ? paidCents - totals.total : 0;
  const insufficient = isCash && (paidCents === null || paidCents < totals.total);

  useEffect(() => {
    if (!open) {
      setMethod('DINHEIRO');
      setAmountText('');
      setCustomerId('');
      setNotes('');
      setError(null);

      return;
    }
    // Sugere exatamente o total quando o pagamento e dinheiro.
    setAmountText((totals.total / 100).toFixed(2).replace('.', ','));
    api
      .get<{ data: { id: number; name: string }[] }>('/api/customers', { perPage: 200, active: true })
      .then((result) => setCustomers(result.data ?? []))
      .catch(() => setCustomers([]));
  }, [open, totals.total]);

  const submit = async () => {
    setError(null);
    if (isCash && insufficient) {
      setError('Informe um valor recebido maior ou igual ao total.');
      return;
    }
    setSaving(true);
    try {
      const sale = await api.post<{
        ok: boolean;
        sale: { id: number; number: number } | null;
        number: number;
        total: number;
        changeCents: number;
        message: string;
      }>('/api/sales', {
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPriceCents,
          discountPercent: line.discountPercent,
        })),
        paymentMethod: method,
        amountPaidCents: isCash ? (paidCents ?? totals.total) : totals.total,
        customerId: customerId ? Number(customerId) : undefined,
        notes: notes.trim() || undefined,
      });

      // Mantem o total visivel antes de limpar o carrinho.
      setTimeout(() => {
        onFinish();
        onClose();
        toast.success(`Venda #${sale.number} registrada`, {
          description:
            sale.changeCents > 0
              ? `Troco: ${money(sale.changeCents)}`
              : `Total: ${money(sale.total)}`,
        });
      }, 1200);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel registrar a venda.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Finalizar venda"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button
            variant="accent"
            onClick={() => void submit()}
            loading={saving} disabled={insufficient}
          >
            Confirmar venda - {money(totals.total)}
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

        <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted p-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{money(totals.subtotal)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Desconto</dt>
            <dd className="tabular-nums">{money(totals.discount)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Total</dt>
            <dd className="font-bold tabular-nums">{money(totals.total)}</dd>
          </div>
        </dl>

        <Field label="Forma de pagamento" htmlFor="pay-method" required>
          <Select
            id="pay-method"
            value={method}
            onChange={(event) => setMethod(event.target.value as SalePaymentMethod)}
          >
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        {isCash && (
          <>
            <Field
              label="Valor recebido"
              htmlFor="pay-amount"
              required
              hint="Digite apenas o numero. Ex.: 100 ou 100,50"
              error={
                amountText.trim() !== '' && paidCents !== null && paidCents < totals.total
                  ? `Valor menor que o total (${money(totals.total)}).`
                  : undefined
              }
            >
              <div className="relative">
                <Input
                  id="pay-amount"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="h-12 pr-12 text-lg font-semibold tabular-nums"
                  invalid={amountText.trim() !== '' && paidCents !== null && paidCents < totals.total}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
                  R$
                </span>
              </div>
            </Field>

            {/* Botoes de dinheiro de rapideza. */}
            <div className="flex flex-wrap gap-1.5">
              {cashSuggestions(totals.total).map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  onClick={() => setAmountText((value / 100).toFixed(2).replace('.', ','))}
                >
                  {money(value)}
                </Button>
              ))}
            </div>

            {paidCents !== null && !insufficient && (
              <div
                className={cn(
                  'flex items-center justify-between rounded-md border p-3',
                  changeCents === 0
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-accent/40 bg-accent/10 text-accent-foreground',
                )}
              >
                <span className="text-sm font-medium">
                  {changeCents === 0 ? 'Valor exato' : 'Troco'}
                </span>
                <span className="text-xl font-bold tabular-nums">
                  {changeCents === 0 ? '-' : money(changeCents)}
                </span>
              </div>
            )}
          </>
        )}

        <Field label="Cliente (opcional)" htmlFor="pay-customer">
          <Select id="pay-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Consumidor nao identificado</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Observacao (opcional)" htmlFor="pay-notes">
          <Input
            id="pay-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: entrega em andamento"
            maxLength={500}
          />
        </Field>

        {!can('cash:open') && (
          <p className="text-xs text-muted-foreground">
            Operador: {user?.name}. A venda sera lancada em um caixa aberto, se houver.
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Sugere cedulas proximas ao total. */
function cashSuggestions(totalCents: number): number[] {
  const notes = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const result = new Set<number>([totalCents]);
  for (const note of notes) {
    const rounded = Math.ceil(totalCents / note) * note;
    if (rounded >= totalCents) result.add(rounded);
  }
  return [...result].sort((a, b) => a - b).slice(0, 6);
}

/* ---------------- Modal de caixa rapido ---------------- */

function QuickCashModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [session, setSession] = useState<{
    id: number;
    status: string;
    expectedAmountCents: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<{ session: { id: number; status: string; expectedAmountCents: number } | null }>(
        '/api/cash/current',
      )
      .then((result) => setSession(result.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Caixa atual" size="sm">
      {loading ? (
        <Spinner />
      ) : session ? (
        <div className="space-y-2 text-sm">
          <p>
            Caixa <strong>#{session.id}</strong> esta <Badge tone="success">ABERTO</Badge>
          </p>
          <p className="text-muted-foreground">
            Saldo esperado em caixa: <strong className="tabular-nums">{money(session.expectedAmountCents)}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            As vendas deste operador sao lancadas automaticamente neste caixa.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            Nenhum caixa aberto. Abra um caixa na tela <strong>Caixa</strong> para que as vendas em
            dinheiro sejam registradas.
          </p>
        </div>
      )}
    </Modal>
  );
}