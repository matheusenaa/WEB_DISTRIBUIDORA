import { reportColumnLabel as humanize } from '@webdist/shared';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { api, downloadFile } from '@/lib/api';
import { dateOnly } from '@/lib/format';

interface ReportDescriptor {
  key: string;
  label: string;
}

interface ReportPayload {
  key: string;
  label: string;
  period: { from: string; to: string };
  columns: string[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

export function ReportsPage() {
  const [key, setKey] = useState('vendas');
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [previewing, setPreviewing] = useState(false);

  const available = useQuery({
    queryKey: ['reports', 'available'],
    queryFn: () => api.get<{ data: ReportDescriptor[] }>('/api/reports/available'),
    staleTime: 10 * 60_000,
  });

  const needsRange = !['produtos', 'estoque', 'produtos-parados'].includes(key);

  const reportQuery = useQuery({
    queryKey: ['reports', 'preview', key, from, to],
    queryFn: () => api.get<ReportPayload>(`/api/reports/${key}`, { from, to }),
    enabled: previewing,
  });

  const selected = available.data?.data.find((item) => item.key === key);

  const download = (format: 'csv' | 'xlsx') => {
    void downloadFile(
      `/api/reports/${key}`,
      { format, from, to },
      `${key}.${format}`,
    ).catch(() => toast.error('Nao foi possivel gerar o arquivo.'));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <BarChart3 className="h-5 w-5 text-accent" aria-hidden />
          Relatorios
        </h1>
        <p className="text-sm text-muted-foreground">
          Gere relatorios em CSV ou Excel e visualize antes de exportar
        </p>
      </div>

      <Card>
        <CardHeader title="Configuracao do relatorio" />
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="report-key" className="text-sm font-medium">
                Relatorio
              </label>
              <Select
                id="report-key"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setPreviewing(false);
                }}
                className="mt-1.5"
              >
                {available.data?.data.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label htmlFor="report-from" className="text-sm font-medium">
                De
              </label>
              <Input
                id="report-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPreviewing(false);
                }}
                disabled={!needsRange}
                className="mt-1.5"
              />
            </div>

            <div>
              <label htmlFor="report-to" className="text-sm font-medium">
                Ate
              </label>
              <Input
                id="report-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPreviewing(false);
                }}
                disabled={!needsRange}
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setPreviewing(true)} disabled={reportQuery.isFetching}>
              Visualizar
            </Button>
            <Button variant="outline" onClick={() => download('csv')}>
              <FileText className="h-4 w-4" aria-hidden />
              Baixar CSV
            </Button>
            <Button variant="outline" onClick={() => download('xlsx')}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              Baixar Excel
            </Button>
          </div>

          {!needsRange && (
            <p className="mt-2 text-xs text-muted-foreground">
              Este relatorio considera todo o historico; o periodo nao se aplica.
            </p>
          )}
        </CardContent>
      </Card>

      {reportQuery.isFetching && <Spinner label="Gerando relatorio..." />}

      {reportQuery.data && (
        <Card>
          <CardHeader
            title={reportQuery.data.label}
            description={`${reportQuery.data.rows.length} linha(s)${
              needsRange
                ? ` - ${dateOnly(reportQuery.data.period.from)} a ${dateOnly(reportQuery.data.period.to)}`
                : ''
            }`}
            action={
              <Badge tone="muted">{selected?.label ?? reportQuery.data.label}</Badge>
            }
          />
          <CardContent className="p-0">
            {reportQuery.data.summary && Object.keys(reportQuery.data.summary).length > 0 && (
              <div className="grid gap-3 border-b border-border bg-muted/40 p-4 sm:grid-cols-4">
                {Object.entries(reportQuery.data.summary).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{humanize(label)}</p>
                    <p className="text-sm font-semibold">{String(value)}</p>
                  </div>
                ))}
              </div>
            )}

            {reportQuery.data.rows.length === 0 ? (
              <EmptyState
                title="Nenhum dado no periodo"
                description="Ajuste as datas do relatorio para obter resultados."
              />
            ) : (
              <div className="max-h-[32rem] overflow-auto">
                <table className="table-compact w-full">
                  <thead className="sticky top-0 bg-muted/95">
                    <tr>
                      {reportQuery.data.columns.map((column) => (
                        <th key={column} scope="col">
                          {humanize(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportQuery.data.rows.slice(0, 500).map((row, index) => (
                      <tr key={index}>
                        {reportQuery.data.columns.map((column) => (
                          <td key={column} className="whitespace-nowrap">
                            {row[column] === null || row[column] === undefined || row[column] === ''
                              ? '-'
                              : String(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {reportQuery.data.rows.length > 500 && (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    Exibindo as primeiras 500 linhas de {reportQuery.data.rows.length}. Baixe o
                    arquivo para ver tudo.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!reportQuery.data && !reportQuery.isFetching && (
        <Card>
          <CardContent>
            <EmptyState
              title="Escolha um relatorio"
              description="Selecione o tipo, defina o periodo e clique em Visualizar."
              icon={<Download className="h-8 w-8" aria-hidden />}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Converte snake_case do backend em texto legivel. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfMonth(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}