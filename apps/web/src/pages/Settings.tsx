import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

interface Settings {
  companyName: string;
  companyDocument: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  currency: string;
  lowStockMarginPercent: number;
  defaultMarginPercent: number;
  maxDiscountPercent: number;
  allowNegativeStock: boolean;
  requireCashSession: boolean;
  saleObservation: string;
}

type SettingsPayload = Record<string, unknown>;

const DEFAULT_SETTINGS: Settings = {
  companyName: '',
  companyDocument: '',
  companyEmail: '',
  companyPhone: '',
  companyAddress: '',
  currency: 'BRL',
  lowStockMarginPercent: 25,
  defaultMarginPercent: 30,
  maxDiscountPercent: 20,
  allowNegativeStock: false,
  requireCashSession: true,
  saleObservation: '',
};

export function SettingsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !can('settings:manage');

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: Settings }>('/api/settings'),
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setValues({ ...DEFAULT_SETTINGS, ...settingsQuery.data.settings });
    }
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: (payload: SettingsPayload) => api.put('/api/settings', payload),
    onSuccess: () => {
      toast.success('Configuracoes salvas.');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar.'),
  });

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = () => {
    setError(null);
    if (values.companyName.trim().length < 2) {
      setError('Informe o nome da empresa.');
      return;
    }
    mutation.mutate(values as unknown as SettingsPayload);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <SettingsIcon className="h-5 w-5 text-accent" aria-hidden />
            Configuracoes
          </h1>
          <p className="text-sm text-muted-foreground">
            {readOnly ? 'Somente leitura' : 'Parametros da empresa e regras do sistema'}
          </p>
        </div>
        {!readOnly && (
          <Button onClick={save} loading={mutation.isPending}>
            <Save className="h-4 w-4" aria-hidden />
            Salvar
          </Button>
        )}
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Badge tone="muted">Leitura</Badge>
          Apenas administradores podem alterar as configuracoes.
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados da empresa" description="Aparecem nos relatorios e comprovantes" />
          <CardContent className="space-y-4">
            <Field label="Nome / razao social" htmlFor="s-company" required>
              <Input
                id="s-company"
                value={values.companyName}
                onChange={(event) => set('companyName', event.target.value)}
                disabled={readOnly}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="CNPJ / CPF" htmlFor="s-doc">
                <Input
                  id="s-doc"
                  value={values.companyDocument}
                  onChange={(event) => set('companyDocument', event.target.value)}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Telefone" htmlFor="s-phone">
                <Input
                  id="s-phone"
                  value={values.companyPhone}
                  onChange={(event) => set('companyPhone', event.target.value)}
                  disabled={readOnly}
                />
              </Field>
            </div>
            <Field label="E-mail" htmlFor="s-email">
              <Input
                id="s-email"
                type="email"
                value={values.companyEmail}
                onChange={(event) => set('companyEmail', event.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Endereco" htmlFor="s-address">
              <Input
                id="s-address"
                value={values.companyAddress}
                onChange={(event) => set('companyAddress', event.target.value)}
                disabled={readOnly}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Regras comerciais" description="Padroes aplicados pelo sistema" />
          <CardContent className="space-y-4">
            <Field
              label="Margem padrao para novos produtos (%)"
              htmlFor="s-margin"
              hint="Sugestao exibida ao cadastrar produtos."
            >
              <Input
                id="s-margin"
                type="number"
                min={0}
                max={99}
                value={values.defaultMarginPercent}
                onChange={(event) => set('defaultMarginPercent', Number(event.target.value))}
                disabled={readOnly}
              />
            </Field>
            <Field
              label="Desconto maximo permitido (%)"
              htmlFor="s-discount"
              hint="Limite que o vendedor pode conceder no PDV."
            >
              <Input
                id="s-discount"
                type="number"
                min={0}
                max={100}
                value={values.maxDiscountPercent}
                onChange={(event) => set('maxDiscountPercent', Number(event.target.value))}
                disabled={readOnly}
              />
            </Field>
            <Field
              label="Percentual do minimo para alerta de estoque (%)"
              htmlFor="s-lowstock"
              hint="Ex.: 25 significa alertar quando o estoque cair abaixo de 25% do minimo."
            >
              <Input
                id="s-lowstock"
                type="number"
                min={0}
                max={100}
                value={values.lowStockMarginPercent}
                onChange={(event) => set('lowStockMarginPercent', Number(event.target.value))}
                disabled={readOnly}
              />
            </Field>
            <Field label="Observacao padrao nas vendas" htmlFor="s-note">
              <Input
                id="s-note"
                value={values.saleObservation}
                onChange={(event) => set('saleObservation', event.target.value)}
                disabled={readOnly}
                placeholder="Ex.: Venda sujeta a conferencia"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Operacao do caixa" />
          <CardContent className="space-y-3">
            <ToggleRow
              label="Exigir caixa aberto para vender"
              description="Quando ativo, impede o registro de venda se nao houver caixa aberto."
              checked={values.requireCashSession}
              disabled={readOnly}
              onChange={(checked) => set('requireCashSession', checked)}
            />
            <ToggleRow
              label="Permitir estoque negativo"
              description="Recomendado manter desativado para evitar venda acima do disponivel."
              checked={values.allowNegativeStock}
              disabled={readOnly}
              onChange={(checked) => set('allowNegativeStock', checked)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Sobre o sistema" />
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sistema</span>
              <span className="font-medium">WEB DISTRIBUIDORA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Versao</span>
              <span className="font-medium">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Moeda</span>
              <span className="font-medium">{values.currency}</span>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Todos os valores monetarios sao calculados e armazenados em centavos, evitando
              divergencias de arredondamento.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 rounded-md border border-border p-3', !disabled && 'cursor-pointer')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--accent))] disabled:opacity-50"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}