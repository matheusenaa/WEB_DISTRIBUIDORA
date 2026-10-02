import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Settings as SettingsIcon, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SettingDTO, SettingGroup } from '@webdist/shared';
import { Badge, Card, CardContent, CardHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

/**
 * CONFIGURACOES
 *
 * A tela e gerada a partir da lista que a API devolve. O backend decide
 * quais regras existem, quais valores aceitam e em que secao aparecem.
 *
 * Isso nao e uma preferencia de estilo: a versao anterior tinha os
 * nomes dos campos escritos a mao aqui e na API, e os dois nao
 * concordavam. A tela lia `data.settings` de uma resposta que devolvia
 * `data[]`, entao mostrava sempre os valores padrao do proprio arquivo, e
 * o `PUT` mandava um corpo que a API rejeitava. Nao carregava e nao
 * salvava nada.
 */

const GROUP_LABELS: Record<SettingGroup, { title: string; description: string }> = {
  EMPRESA: {
    title: 'Dados da empresa',
    description: 'Aparecem no cabecalho e no cupom.',
  },
  VENDAS: {
    title: 'Regras de venda',
    description: 'Aplicadas pelo servidor no momento da venda.',
  },
  ESTOQUE: {
    title: 'Estoque',
    description: 'Parametros de alerta e reposicao.',
  },
  CAIXA: {
    title: 'Operacao do caixa',
    description: 'Abertura, fechamento e tolerancias.',
  },
  IMPRESSAO: {
    title: 'Impressao',
    description: 'Cupom e impressoras locais.',
  },
};

const GROUP_ORDER: SettingGroup[] = ['EMPRESA', 'VENDAS', 'ESTOQUE', 'CAIXA', 'IMPRESSAO'];

type Drafts = Record<string, string>;

function toDrafts(settings: SettingDTO[]): Drafts {
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

export function SettingsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Drafts>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const readOnly = !can('settings:manage');

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ data: SettingDTO[] }>('/api/settings'),
  });

  useEffect(() => {
    if (settingsQuery.data?.data) setDrafts(toDrafts(settingsQuery.data.data));
  }, [settingsQuery.data]);

  const groups = useMemo(() => {
    const all = settingsQuery.data?.data ?? [];
    return GROUP_ORDER.map((group) => ({
      group,
      items: all.filter((item) => item.group === group),
    })).filter((section) => section.items.length > 0);
  }, [settingsQuery.data]);

  const mutation = useMutation({
    // O corpo e um mapa `{ chave: "valor" }`: os valores sao sempre
    // string porque a API valida e normaliza cada um pela sua definicao.
    mutationFn: (settings: Record<string, string>) =>
      api.put<{ rejected: Array<{ key: string; reason: string }>; message: string }>(
        '/api/settings',
        { settings },
      ),
    onSuccess: (result) => {
      if (result.rejected.length > 0) {
        setFieldErrors(Object.fromEntries(result.rejected.map((r) => [r.key, r.reason])));
        setError('Uma ou mais configuracoes nao puderam ser salvas.');
      } else {
        setFieldErrors({});
        setError(null);
      }
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (caught) => {
      // O erro de validacao da API vem com a lista por chave.
      const details = caught instanceof ApiError ? caught.details : null;
      const rejected = Array.isArray(details)
        ? (details as Array<{ key: string; reason: string }>)
        : [];
      if (rejected.length > 0) {
        setFieldErrors(Object.fromEntries(rejected.map((r) => [r.key, r.reason])));
      } else {
        setFieldErrors({});
      }
      setError(caught instanceof ApiError ? caught.message : 'Nao foi possivel salvar.');
    },
  });

  const set = (key: string, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const reset = () => {
    setDrafts(toDrafts(settingsQuery.data?.data ?? []));
    setFieldErrors({});
    setError(null);
  };

  const save = () => {
    setError(null);
    // Manda so o que mudou: reassinar tudo reexecutaria a validacao de
    // campos que o usuario nem tocou.
    const original = toDrafts(settingsQuery.data?.data ?? []);
    const changed = Object.fromEntries(
      Object.entries(drafts).filter(([key, value]) => original[key] !== value),
    );
    if (Object.keys(changed).length === 0) {
      setError('Nenhuma alteracao a salvar.');
      return;
    }
    mutation.mutate(changed);
  };

  const hasChanges =
    settingsQuery.data != null &&
    Object.entries(drafts).some(([key, value]) => toDrafts(settingsQuery.data.data)[key] !== value);

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
          <>
            <Button variant="secondary" onClick={reset} disabled={!hasChanges || mutation.isPending}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Descartar
            </Button>
            <Button onClick={save} loading={mutation.isPending} disabled={!hasChanges}>
              <Save className="h-4 w-4" aria-hidden />
              Salvar
            </Button>
          </>
        )}
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Badge tone="muted">Leitura</Badge>
          Apenas administradores podem alterar as configuracoes.
        </div>
      )}

      {error && <FormError>{error}</FormError>}

      {settingsQuery.isLoading && (
        <p className="text-sm text-muted-foreground" role="status">
          Carregando configuracoes...
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((section) => (
          <Card key={section.group}>
            <CardHeader
              title={GROUP_LABELS[section.group].title}
              description={GROUP_LABELS[section.group].description}
            />
            <CardContent className="space-y-4">
              {section.items.map((item) => (
                <SettingField
                  key={item.key}
                  item={item}
                  value={drafts[item.key] ?? item.value}
                  error={fieldErrors[item.key]}
                  disabled={readOnly}
                  changed={
                    settingsQuery.data != null &&
                    toDrafts(settingsQuery.data.data)[item.key] !== drafts[item.key]
                  }
                  onChange={(value) => set(item.key, value)}
                />
              ))}
            </CardContent>
          </Card>
        ))}

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
              <span className="font-medium">BRL</span>
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

function SettingField({
  item,
  value,
  error,
  disabled,
  changed,
  onChange,
}: {
  item: SettingDTO;
  value: string;
  error: string | undefined;
  disabled: boolean;
  changed: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = `setting-${item.key.replace(/\./g, '-')}`;
  const describedBy = error ? `${inputId}-error` : item.help ? `${inputId}-help` : undefined;

  const label = item.label;

  if (item.type === 'boolean') {
    return (
      <label
        className={cn(
          'flex items-start gap-2.5 rounded-md border border-border p-3',
          !disabled && 'cursor-pointer',
          error && 'border-destructive',
        )}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--accent))] disabled:opacity-50"
        />
        <span className="space-y-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            {item.label}
            {changed && <Badge tone="accent">alterado</Badge>}
          </span>
          {item.help && <span className="block text-xs text-muted-foreground">{item.help}</span>}
          {error && (
            <span id={`${inputId}-error`} className="block text-xs text-destructive">
              {error}
            </span>
          )}
        </span>
      </label>
    );
  }

  return (
    <Field label={label} htmlFor={inputId} hint={item.help ?? undefined} error={error}>
      {item.type === 'number' ? (
        <Input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : item.options ? (
        <Select
          id={inputId}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {item.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={inputId}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {changed && !error && (
        <span className="block text-xs text-accent">Alterado, ainda nao salvo.</span>
      )}
    </Field>
  );
}