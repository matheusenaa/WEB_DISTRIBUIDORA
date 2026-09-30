import {
  applyPercentDiscount,
  marginFromPrice,
  parseMoneyToCents,
  priceFromMargin,
  priceFromMarkup,
} from '@webdist/shared';
import { Calculator, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { money, percent } from '@/lib/format';

type Mode = 'MARKUP' | 'MARGEM';

export function CalculatorPage() {
  const [mode, setMode] = useState<Mode>('MARKUP');
  const [cost, setCost] = useState('');
  const [percentage, setPercentage] = useState('40');
  const [quantity, setQuantity] = useState('1');

  const costCents = parseMoneyToCents(cost) ?? 0;
  const percentValue = Number(percentage.replace(',', '.')) || 0;
  const qtyValue = Number(quantity.replace(',', '.')) || 0;

  const priceCents =
    mode === 'MARKUP'
      ? priceFromMarkup(costCents, percentValue)
      : priceFromMargin(costCents, percentValue);

  const profit = priceCents - costCents;
  const actualMargin = marginFromPrice(priceCents, costCents);
  const actualMarkup = costCents > 0 ? (profit / costCents) * 100 : 0;

  const results = useMemo(
    () => [
      { label: 'Preco de venda unitario', value: money(priceCents), emphasis: true },
      { label: 'Custo unitario', value: money(costCents) },
      { label: 'Lucro por unidade', value: money(profit), tone: profit >= 0 ? 'success' : 'destructive' },
      { label: `Margem sobre venda (${mode === 'MARGEM' ? 'definida' : 'resultante'})`, value: percent(actualMargin) },
      { label: 'Markup sobre custo', value: percent(actualMarkup) },
      { label: 'Preco total (' + qtyValue + ' un)', value: money(priceCents * Math.max(1, qtyValue)) },
      { label: 'Lucro total', value: money(profit * Math.max(1, qtyValue)), tone: profit >= 0 ? 'success' : 'destructive' },
    ],
    [priceCents, costCents, profit, actualMargin, actualMarkup, qtyValue, mode],
  );

  // Ponto de equilibrio: abaixo disso a venda da em dinheiro.
  const breakEvenUnits = profit >= 0 && profit > 0 ? Math.ceil(costCents / profit) : null;

  // Quanto custa conceder um desconto antes de ficar sem lucro.
  const maxDiscount = priceCents > 0 ? (profit / priceCents) * 100 : 0;

  const reset = () => {
    setCost('');
    setPercentage('40');
    setQuantity('1');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Calculator className="h-5 w-5 text-accent" aria-hidden />
          Calculadora de precos
        </h1>
        <p className="text-sm text-muted-foreground">
          Calcule precos de venda a partir do custo, por markup ou por margem
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Calculo" />
          <CardContent className="space-y-4">
            <Field label="Modo de calculo" htmlFor="calc-mode">
              <div className="flex gap-2">
                <Button
                  variant={mode === 'MARKUP' ? 'default' : 'outline'}
                  onClick={() => setMode('MARKUP')}
                  className="flex-1"
                >
                  Por markup
                </Button>
                <Button
                  variant={mode === 'MARGEM' ? 'default' : 'outline'}
                  onClick={() => setMode('MARGEM')}
                  className="flex-1"
                >
                  Por margem
                </Button>
              </div>
            </Field>

            <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              {mode === 'MARKUP'
                ? 'Markup e o percentual acrescentado SOBRE O CUSTO. Ex.: custo 10 com markup 40% = preco 14.'
                : 'Margem e o percentual de lucro SOBRE O PRECO DE VENDA. Ex.: preco 14 com margem 28,6% = lucro 4.'}
            </p>

            <Field label="Custo unitario" htmlFor="calc-cost" required>
              <Input
                id="calc-cost"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                autoFocus
                className="h-12 text-lg font-semibold tabular-nums"
              />
            </Field>

            <Field
              label={mode === 'MARKUP' ? 'Markup desejado (%)' : 'Margem desejada (%)'}
              htmlFor="calc-percent"
              required
            >
              <div className="flex gap-2">
                <Input
                  id="calc-percent"
                  value={percentage}
                  onChange={(event) => setPercentage(event.target.value)}
                  inputMode="decimal"
                  className="h-12 text-lg font-semibold tabular-nums"
                />
                <Select
                  value={percentage}
                  onChange={(event) => setPercentage(event.target.value)}
                  aria-label="Valores rapidos"
                  className="w-28"
                >
                  {mode === 'MARKUP' ? (
                    <>
                      <option value="">--</option>
                      {[20, 30, 40, 50, 60, 80, 100].map((value) => (
                        <option key={value} value={value}>
                          {value}%
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="">--</option>
                      {[10, 15, 20, 25, 30, 35, 40, 50].map((value) => (
                        <option key={value} value={value}>
                          {value}%
                        </option>
                      ))}
                    </>
                  )}
                </Select>
              </div>
            </Field>

            <Field label="Quantidade vendida" htmlFor="calc-qty" hint="Opcional: mostra o total.">
              <Input
                id="calc-qty"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                min={1}
              />
            </Field>

            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Limpar
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Resultado" />
            <CardContent>
              {costCents > 0 && priceCents > 0 ? (
                <>
                  <dl className="space-y-2 text-sm">
                    {results.map((result) => (
                      <div
                        key={result.label}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2 py-1.5',
                          result.emphasis && 'bg-primary text-primary-foreground',
                          result.tone === 'success' && 'bg-success/10 text-success',
                          result.tone === 'destructive' && 'bg-destructive/10 text-destructive',
                        )}
                      >
                        <dt className={cn('text-muted-foreground', result.emphasis && 'text-primary-foreground/80')}>
                          {result.label}
                        </dt>
                        <dd className={cn('tabular-nums', result.emphasis && 'text-xl font-bold')}>
                          {result.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {profit < 0 && (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      Com esse percentual o preco fica abaixo do custo: cada venda perde{' '}
                      {money(Math.abs(profit))}.
                    </div>
                  )}

                  {breakEvenUnits !== null && (
                    <div className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
                      <p className="font-medium">Ponto de equilibrio</p>
                      <p className="text-muted-foreground">
                        Sao necessarias <strong className="tabular-nums">{breakEvenUnits}</strong> venda(s)
                        para cobrir o custo unitario.
                      </p>
                    </div>
                  )}

                  <div className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
                    <p className="font-medium">Desconto maximo</p>
                    <p className="text-muted-foreground">
                      Da para conceder ate <strong className="tabular-nums">{percent(maxDiscount)}</strong>{' '}
                      de desconto sem ficar abaixo do custo.
                    </p>
                    {maxDiscount > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Desconto de {percent(maxDiscount)} = {money(applyPercentDiscount(priceCents, maxDiscount))}{' '}
                        por unidade.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Informe o custo e o percentual para ver o resultado.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}