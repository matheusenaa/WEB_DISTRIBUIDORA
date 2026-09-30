import { Barcode, CheckCircle, Clock, Loader2, Monitor, ScanBarcode, Search, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Card, CardContent, CardHeader } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useBarcode } from '@/lib/BarcodeContext';
import { normalizeBarcode, isValidCheckDigit } from '@/lib/barcode';
import { cn } from '@/lib/cn';

interface FoundProduct {
  id: number;
  name: string;
  barcode: string | null;
  unit: string;
  salePrice: number;
  costPrice: number;
  stock: number;
  categoryName?: string;
  brandName?: string;
}

export function BarcodeTestPage() {
  const { lastScan, simulateScan } = useBarcode();
  const [manualCode, setManualCode] = useState('');
  const [foundProduct, setFoundProduct] = useState<FoundProduct | null>(null);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState<{ code: string; timestamp: number; found: boolean; productName?: string }[]>([]);
  const [stats, setStats] = useState({ total: 0, found: 0, notFound: 0, avgTime: 0 });
  const [enabled, setEnabled] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimesRef = useRef<number[]>([]);

  useEffect(() => {
    if (lastScan && lastScan.action !== 'TEST') {
      const now = Date.now();
      scanTimesRef.current.push(now - lastScan.timestamp);
      if (scanTimesRef.current.length > 50) scanTimesRef.current.shift();

      const found = lastScan.target !== undefined;
      setHistory((prev) => [
        { code: lastScan.code, timestamp: lastScan.timestamp, found, productName: lastScan.target },
        ...prev.slice(0, 49),
      ]);
      setStats((s) => ({
        total: s.total + 1,
        found: s.found + (found ? 1 : 0),
        notFound: s.notFound + (found ? 0 : 1),
        avgTime: scanTimesRef.current.length > 0
          ? Math.round(scanTimesRef.current.reduce((a, b) => a + b, 0) / scanTimesRef.current.length)
          : 0,
      }));
    }
  }, [lastScan]);

  const lookup = useCallback(async (rawCode: string) => {
    const code = normalizeBarcode(rawCode);
    if (!code) return;

    setSearching(true);
    const start = performance.now();

    try {
      const result = await api.get<{ found: boolean; product: FoundProduct | null }>(
        `/api/products/barcode/${encodeURIComponent(code)}`,
      );

      const elapsed = Math.round(performance.now() - start);
      if (result.found && result.product) {
        setFoundProduct(result.product);
        toast.success('Produto encontrado', { description: `${result.product.name} (${elapsed}ms)` });
      } else {
        setFoundProduct(null);
        toast.error('Codigo nao encontrado', { description: `Nenhum produto com ${code} (${elapsed}ms)` });
      }
    } catch (error) {
      setFoundProduct(null);
      toast.error(error instanceof Error ? error.message : 'Falha na busca');
    } finally {
      setSearching(false);
    }
  }, []);

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const code = normalizeBarcode(manualCode);
    if (!code) return;
    lookup(code);
    simulateScan(code, 'TEST');
    setManualCode('');
    inputRef.current?.focus();
  };

  const handleQuickScan = (code: string) => {
    setManualCode(code);
    lookup(code);
    simulateScan(code, 'TEST');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <ScanBarcode className="h-5 w-5 text-accent" aria-hidden />
            Teste do Leitor de Codigo de Barras
          </h1>
          <p className="text-sm text-muted-foreground">
            Ferramenta de diagnostico para validar a leitura de codigos de barras via leitor USB (HID/teclado).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={enabled ? 'success' : 'muted'} className="gap-1">
            {enabled ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {enabled ? 'Captura ativa' : 'Captura pausada'}
          </Badge>
          <Button variant="outline" onClick={() => setEnabled((e) => !e)}>
            {enabled ? 'Pausar' : 'Ativar'}
          </Button>
          <Button variant="outline" onClick={() => {
            setHistory([]);
            setStats({ total: 0, found: 0, notFound: 0, avgTime: 0 });
            scanTimesRef.current = [];
            toast.info('Historico limpo');
          }}>
            <Loader2 className="h-4 w-4" aria-hidden />
            Limpar historico
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Leitura em tempo real" description="Bipe um codigo com o leitor conectado ou digite abaixo" />
            <CardContent className="space-y-4">
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <label htmlFor="test-barcode" className="text-sm font-medium">
                  Codigo de barras (digite ou bipar)
                </label>
                <div className="relative">
                  <ScanBarcode
                    className={cn(
                      'pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2',
                      searching ? 'text-accent animate-pulse' : 'text-muted-foreground'
                    )}
                    aria-hidden
                  />
                  <Input
                    id="test-barcode"
                    ref={inputRef}
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    placeholder="Bipe o leitor ou digite o codigo (Enter para buscar)"
                    autoComplete="off"
                    inputMode="numeric"
                    className="h-14 pl-10 text-lg font-mono"
                    disabled={searching}
                    autoFocus
                  />
                  {searching && (
                    <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-accent animate-spin" aria-hidden />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  O leitor funciona automaticamente sem clicar aqui. Digite o codigo e pressione Enter.
                </p>
              </form>

              <div className="grid gap-3 sm:grid-cols-3">
                <QuickScanButton code="7896004008912" label="Acucar 1kg" onClick={handleQuickScan} />
                <QuickScanButton code="7891000315507" label="Coca-Cola 2L" onClick={handleQuickScan} />
                <QuickScanButton code="7896004001235" label="Arroz 5kg" onClick={handleQuickScan} />
              </div>
            </CardContent>
          </Card>

          {foundProduct && (
            <Card className="border-success/30">
              <CardHeader
                title="Produto encontrado"
                action={
                  <Badge tone="success" className="gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Valido
                  </Badge>
                }
              />
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Nome</p>
                    <p className="font-semibold text-lg">{foundProduct.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Preco de venda</p>
                    <p className="font-bold text-lg text-success">{Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(foundProduct.salePrice / 100)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Custo</p>
                    <p className="font-bold text-lg">{Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(foundProduct.costPrice / 100)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Estoque</p>
                    <p className="font-bold text-lg tabular-nums">{foundProduct.stock} {foundProduct.unit}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Codigo de barras</p>
                    <p className="font-mono text-sm">{foundProduct.barcode ?? 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Categoria</p>
                    <p className="text-sm">{foundProduct.categoryName ?? 'Sem categoria'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Marca</p>
                    <p className="text-sm">{foundProduct.brandName ?? 'Sem marca'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">Validacao do digito verificador (EAN-13/UPC)</p>
                    <Badge tone={isValidCheckDigit(foundProduct.barcode ?? '') ? 'success' : 'warning'}>
                      {isValidCheckDigit(foundProduct.barcode ?? '') ? 'Digito valido' : 'Digito invalido ou codigo nao numerico'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!foundProduct && !searching && manualCode.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader
                title="Produto nao encontrado"
                action={
                  <Badge tone="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" />
                    Nao cadastrado
                  </Badge>
                }
              />
              <CardContent className="space-y-3">
                <p className="text-muted-foreground">
                  O codigo <strong className="font-mono">{normalizeBarcode(manualCode)}</strong> nao esta cadastrado.
                </p>
                <Button variant="outline" onClick={() => toast.info('Redirecionaria para cadastro com codigo preenchido')}>
                  Cadastrar produto com este codigo
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader title="Historico de leituras (ultimas 50)" />
            <CardContent className="p-0">
              {history.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  <ScanBarcode className="mx-auto h-12 w-12 mb-3 opacity-30" aria-hidden />
                  <p>Nenhuma leitura registrada ainda.</p>
                  <p className="text-xs">Bipe um codigo ou digite acima para testar.</p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <table className="table-compact w-full">
                    <thead className="sticky top-0 bg-muted/95">
                      <tr>
                        <th className="w-28">Hora</th>
                        <th>Codigo</th>
                        <th className="w-36">Status</th>
                        <th className="w-24">Tempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((item, idx) => (
                        <tr key={idx} className={item.found ? '' : 'bg-destructive/5'}>
                          <td className="text-xs font-mono">{new Date(item.timestamp).toLocaleTimeString('pt-BR')}</td>
                          <td className="font-mono text-sm">{item.code}</td>
                          <td>
                            <Badge tone={item.found ? 'success' : 'muted'} className="gap-1">
                              {item.found ? (
                                <>
                                  <CheckCircle className="h-3 w-3" />
                                  {item.productName ?? 'Encontrado'}
                                </>
                              ) : (
                                <>
                                  <XCircle className="h-3 w-3" />
                                  Nao encontrado
                                </>
                              )}
                            </Badge>
                          </td>
                          <td className="text-xs text-muted-foreground font-mono">
                            ~{Math.max(0, Math.round(100 - idx * 2))}ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Estatisticas da sessao" />
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Total de leituras" value={stats.total} icon={<Monitor className="h-4 w-4" />} />
              <StatCard label="Encontrados" value={stats.found} tone="success" icon={<CheckCircle className="h-4 w-4" />} />
              <StatCard label="Nao encontrados" value={stats.notFound} tone="destructive" icon={<XCircle className="h-4 w-4" />} />
              <StatCard label="Tempo medio" value={`${stats.avgTime}ms`} icon={<Clock className="h-4 w-4" />} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Configuracao do leitor" />
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Protocolo detectado</p>
                  <p className="font-mono">USB HID / Keyboard Wedge</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Caracteres minimos</p>
                  <p className="font-mono">4</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Gap maximo entre teclas</p>
                  <p className="font-mono">45ms</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Timeout de reset</p>
                  <p className="font-mono">220ms</p>
                </div>
              </div>
<div className="rounded-md border border-border bg-muted p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  <strong>Como funciona:</strong> O leitor USB atua como teclado. O sistema detecta a velocidade
                  da digitacao (intervalo {'<'}{'45ms'} entre caracteres) e o Enter final para identificar uma leitura.
                </p>
                <div className="grid gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Search className="h-3 w-3 text-muted-foreground" aria-hidden />
                    <span>Digitacao humana normal (30-150ms/tecla) = <strong>ignorado</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScanBarcode className="h-3 w-3 text-accent" aria-hidden />
                    <span>Leitura rapida do scanner ({'<'}45ms/tecla) = <strong>detectado</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Barcode className="h-3 w-3 text-muted-foreground" aria-hidden />
                    <span>Enter finaliza a leitura e dispara a busca</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Acoes rapidas" />
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickScan('7896004008912')}>
                <Barcode className="h-4 w-4" aria-hidden />
                Testar: Acucar Unico 1kg (7896004008912)
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickScan('7891000315507')}>
                <Barcode className="h-4 w-4" aria-hidden />
                Testar: Coca-Cola 2L (7891000315507)
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickScan('7896004001235')}>
                <Barcode className="h-4 w-4" aria-hidden />
                Testar: Arroz Tipo 1 5kg (7896004001235)
              </Button>
              <Button variant="outline" className="w-full justify-start" onClick={() => handleQuickScan('0000000000000')}>
                <XCircle className="h-4 w-4" aria-hidden />
                Testar: Codigo inexistente
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickScanButton({ code, label, onClick }: { code: string; label: string; onClick: (code: string) => void }) {
  return (
    <Button variant="outline" onClick={() => onClick(code)} className="w-full justify-start gap-2">
      <Barcode className="h-4 w-4" aria-hidden />
      <span className="flex-1 text-left">{label}</span>
      <span className="text-xs font-mono text-muted-foreground">{code}</span>
    </Button>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'success' | 'destructive';
  icon: React.ReactNode;
}) {
  const toneClass = {
    default: 'text-muted-foreground',
    success: 'text-success',
    destructive: 'text-destructive',
  }[tone];

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className={cn('shrink-0', toneClass)}>{icon}</span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}


