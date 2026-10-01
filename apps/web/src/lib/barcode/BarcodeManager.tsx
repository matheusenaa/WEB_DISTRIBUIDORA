import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import { cn } from '../cn';
import type { ProductDTO } from '@webdist/shared';
import { createBarcodeDetector, isValidCheckDigit, normalizeBarcode, type DetectedRead } from './detector';

/**
 * BARCODE MANAGER
 * ===============
 *
 * Ponto unico de entrada do codigo de barras em toda a aplicacao.
 *
 *   LEITOR USB
 *       |
 *       v
 *   CAPTURA  (detector.ts - ritmo de teclas)
 *       |
 *       v
 *   BARCODE MANAGER  <-- este arquivo
 *       |
 *       +-- normaliza e valida o codigo
 *       +-- identifica o contexto ativo (pilha)
 *       +-- consulta o SQLite (via API, com cache curto)
 *       +-- entrega o produto ao contexto
 *       +-- feedback sonoro e visual
 *       |
 *       v
 *   TELA (cadastro / pesquisa / estoque / PDV)
 *
 * Problema que este arquivo resolve
 * ---------------------------------
 * Antes havia dois capturadores concorrentes:
 *   - `useBarcodeScanner` (hook) em Pdv/Products;
 *   - `BarcodeProvider` (global) usando `window.__barcodeBuffer`.
 * Os dois ouviam `window`, com criterios diferentes, e o global
 * disparava TODOS os listeners registrados ao mesmo tempo. Um modal
 * aberto sobre a listagem fazia a leitura ser tratada pela tela e pelo
 * formulario; o `window.__barcodeBuffer` ainda vazava estado entre rotas.
 *
 * Como o conflito e resolvido
 * ---------------------------
 * Uma unica captura + uma PILHA de contextos. Cada tela/ modal registra
 * o contexto que sabe tratar; a leitura e entregue apenas ao contexto no
 * TOPO da pilha. Abrir o formulario sobre a listagem empilha o contexto
 * do formulario, entao ele recebe a leitura e a listagem nao. Ao fechar,
 * a pilha volta a ter a listagem no topo.
 */

/** Contexto = a acao que a leitura deve disparar. */
export type BarcodeContextId =
  | 'PRODUCT_FORM'
  | 'PRODUCT_SEARCH'
  | 'PDV'
  | 'STOCK_MOVEMENT'
  | 'STOCK_LOOKUP'
  | 'NONE';

export type ScanSource = 'SCANNER' | 'MANUAL' | 'SIMULADO';

export interface ScanResult {
  code: string;
  found: boolean;
  product: ProductDTO | null;
  source: ScanSource;
  at: number;
}

export interface BarcodeScanDetail {
  code: string;
  source: ScanSource;
  charCount: number;
  durationMs: number;
  averageGapMs: number;
  /** 'OK' quando o digito verificador confere; 'SUSPEITO' caso contrario. */
  checkDigit: 'OK' | 'SUSPEITO';
}

interface BarcodeManagerValue {
  /** Contexto no topo da pilha: quem esta recebendo leituras agora. */
  context: BarcodeContextId;
  /** Registra um contexto. Retorna a funcao de limpeza (useEffect). */
  register: (
    ctx: BarcodeContextId,
    handler: (result: ScanResult) => void | Promise<void>,
  ) => () => void;
  /** Ultima leitura crua, para a tela de diagnostico. */
  lastRead: BarcodeScanDetail | null;
  /** Ultimo resultado resolvido (com ou sem produto). */
  lastResult: ScanResult | null;
  stats: { total: number; found: number; notFound: number };
  /** Simula uma leitura (botao "testar" ou shortcut). */
  simulate: (code: string) => void;
  /** Liga/desliga a captura global. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Consulta produto por codigo, com cache curto. */
  lookup: (code: string) => Promise<ProductDTO | null>;
  /** Zera buffer do detector e as leituras exibidas. */
  reset: () => void;
}

const BarcodeManagerContext = createContext<BarcodeManagerValue | null>(null);

/* ------------------------------------------------------------------ */
/* Feedback sonoro (Web Audio, sem asset externo)                      */
/* ------------------------------------------------------------------ */

/**
 * Bipes curtos gerados por Web Audio: nao ha arquivo de audio no projeto,
 * o que evita dependencia de asset e funciona 100% offline.
 *
 * O AudioContext e criado UMA vez e reaproveitado. Criar um contexto por
 * bip estouraria o limite de contextos simultaneos do navegador depois de
 * algumas dezenas de leituras no mesmo dia de balcao.
 */
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    // Navegadores suspendem o contexto ate uma interacao do usuario.
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

function beep(kind: 'ok' | 'notFound'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    if (kind === 'ok') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
      return;
    }

    // Duplo e grave: rejeita sem assustar o cliente no balcao.
    [0, 0.13].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(offset === 0 ? 220 : 165, now + offset);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.13);
    });
  } catch {
    // Audio bloqueado: o feedback visual ja foi mostrado.
  }
}

/* ------------------------------------------------------------------ */
/* Cache curto de consulta por codigo                                  */
/* ------------------------------------------------------------------ */

/**
 * Cache de 30s. No PDV o operador bipa o mesmo codigo varias vezes
 * seguidas (3 x o mesmo produto) e sem cache seriam 3 consultas
 * identicas ao SQLite. A API ja invalida o proprio cache ao alterar o
 * produto, entao um TTL local curto nao serve preco velho.
 */
const LOOKUP_TTL_MS = 30_000;
const lookupCache = new Map<string, { expires: number; product: ProductDTO | null }>();

function cacheGet(key: string): ProductDTO | null | undefined {
  const entry = lookupCache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    lookupCache.delete(key);
    return undefined;
  }
  return entry.product;
}

function cacheSet(key: string, product: ProductDTO | null): void {
  if (lookupCache.size > 300) lookupCache.clear();
  lookupCache.set(key, { expires: Date.now() + LOOKUP_TTL_MS, product });
}

/**
 * Invalida o cache local. Use apos criar/editar produto para que um
 * codigo reatribuido nao devolva o produto anterior.
 */
export function invalidateBarcodeCache(barcodes: (string | null | undefined)[] = []): void {
  for (const code of barcodes) {
    if (code) lookupCache.delete(normalizeBarcode(code));
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

interface ContextEntry {
  id: number;
  ctx: BarcodeContextId;
  handler: (result: ScanResult) => void | Promise<void>;
}

export function BarcodeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const [lastRead, setLastRead] = useState<BarcodeScanDetail | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [stats, setStats] = useState({ total: 0, found: 0, notFound: 0 });
  const [context, setContext] = useState<BarcodeContextId>('NONE');

  // Pilha de contextos. O topo e quem recebe a leitura.
  const stackRef = useRef<ContextEntry[]>([]);
  const nextIdRef = useRef(1);
  const detectorRef = useRef<ReturnType<typeof createBarcodeDetector> | null>(null);
  const statsRef = useRef({ total: 0, found: 0, notFound: 0 });

  const syncContext = useCallback(() => {
    const stack = stackRef.current;
    const top = stack.length > 0 ? stack[stack.length - 1]! : null;
    setContext(top ? top.ctx : 'NONE');
  }, []);

  /* ---------------- Consulta ao banco ---------------- */

  const lookup = useCallback(async (code: string): Promise<ProductDTO | null> => {
    const clean = normalizeBarcode(code);
    if (!clean) return null;

    const cached = cacheGet(clean);
    if (cached !== undefined) return cached;

    try {
      const response = await api.get<{ found: boolean; product: ProductDTO | null }>(
        `/api/products/barcode/${encodeURIComponent(clean)}`,
      );
      cacheSet(clean, response.product ?? null);
      return response.product ?? null;
    } catch {
      // Indisponivel: devolve null e deixa a tela tratar. Nao cacheia o
      // erro, para nao congelar "nao encontrado" durante a queda da API.
      return null;
    }
  }, []);

  /* ---------------- Pipeline de leitura ---------------- */

  const handleScan = useCallback(
    async (code: string, source: ScanSource, detail?: Partial<BarcodeScanDetail>) => {
      const clean = normalizeBarcode(code);

      if (!clean) {
        toast.error('Codigo de barras invalido.', {
          description: 'Nenhum caractere util foi detectado.',
        });
        return;
      }

      setLastRead({
        code: clean,
        source,
        charCount: detail?.charCount ?? clean.length,
        durationMs: detail?.durationMs ?? 0,
        averageGapMs: detail?.averageGapMs ?? 0,
        checkDigit: isValidCheckDigit(clean) ? 'OK' : 'SUSPEITO',
      });

      // Menos de 4 caracteres quase sempre e tecla perdida, nao codigo.
      if (clean.length < 4) {
        toast.error('Codigo muito curto.', { description: `${clean} - tente novamente.` });
        return;
      }

      const product = await lookup(clean);
      const result: ScanResult = {
        code: clean,
        found: product !== null,
        product,
        source,
        at: Date.now(),
      };
      setLastResult(result);

      statsRef.current = {
        total: statsRef.current.total + 1,
        found: statsRef.current.found + (product ? 1 : 0),
        notFound: statsRef.current.notFound + (product ? 0 : 1),
      };
      setStats(statsRef.current);

      beep(product ? 'ok' : 'notFound');

      // Entrega ao contexto do topo da pilha.
      const top = stackRef.current[stackRef.current.length - 1];
      if (top) {
        await top.handler(result);
        return;
      }

      // Sem contexto: confirma que o leitor esta funcionando.
      if (product) {
        toast.success('Codigo lido com sucesso.', {
          description: `${product.name} - nenhuma tela esta com o leitor em foco.`,
        });
      } else {
        toast.error('Produto nao cadastrado.', {
          description: `${clean} - nenhuma tela esta com o leitor em foco.`,
        });
      }
    },
    [lookup],
  );

  // Ref sempre apontando para a versao mais recente: evita religar a
  // captura a cada render do PDV.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  /* ---------------- Captura do leitor ---------------- */

  useEffect(() => {
    const detector = createBarcodeDetector({
      enabled,
      onRead: (read: DetectedRead) => {
        void handleScanRef.current(read.code, 'SCANNER', {
          charCount: read.charCount,
          durationMs: read.durationMs,
          averageGapMs: read.averageGapMs,
        });
      },
    });
    detectorRef.current = detector;
    return () => {
      detector.destroy();
      detectorRef.current = null;
    };
  }, [enabled]);

  /* ---------------- Digitacao manual em campo de barcode ------------- */
  /* O detector de ritmo NAO dispara para digitacao humana (corretamente:
     digitar devagar nao e leitura). O requisito do documento - digitar
     "7891234567890" e dar Enter deve ter o mesmo efeito do leitor - e
     resolvido aqui: campos marcados com `data-barcode-input` tratam o
     Enter como submissao explicita, convergindo no mesmo `handleScan`. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName?.toUpperCase() !== 'INPUT') return;
      if (target.getAttribute('data-barcode-input') === null) return;
      const value = (target as HTMLInputElement).value.trim();
      if (value.length === 0) return;

      event.preventDefault();
      event.stopPropagation();
      void handleScanRef.current(value, 'MANUAL', { charCount: value.length });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  /* ---------------- Registro de contexto ---------------- */

  const register = useCallback(
    (ctx: BarcodeContextId, handler: (result: ScanResult) => void | Promise<void>) => {
      const entry: ContextEntry = { id: nextIdRef.current++, ctx, handler };
      stackRef.current.push(entry);
      syncContext();

      return () => {
        stackRef.current = stackRef.current.filter((item) => item.id !== entry.id);
        syncContext();
      };
    },
    [syncContext],
  );

  /**
   * Trocar de contexto ZERA o buffer do detector. Sem isso, uma leitura
   * iniciada numa tela pode ser completada na proxima, adicionando o
   * produto errado ao carrinho.
   */
  useEffect(() => {
    detectorRef.current?.reset();
  }, [context]);

  const simulate = useCallback((code: string) => {
    void handleScanRef.current(code, 'SIMULADO', { charCount: code.length });
  }, []);

  const reset = useCallback(() => {
    detectorRef.current?.reset();
    setLastRead(null);
    setLastResult(null);
    statsRef.current = { total: 0, found: 0, notFound: 0 };
    setStats(statsRef.current);
  }, []);

  const value = useMemo<BarcodeManagerValue>(
    () => ({
      context,
      register,
      lastRead,
      lastResult,
      stats,
      simulate,
      enabled,
      setEnabled,
      lookup,
      reset,
    }),
    [context, register, lastRead, lastResult, stats, simulate, enabled, lookup, reset],
  );

  return <BarcodeManagerContext.Provider value={value}>{children}</BarcodeManagerContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useBarcodeManager(): BarcodeManagerValue {
  const context = useContext(BarcodeManagerContext);
  if (!context) {
    throw new Error('useBarcodeManager precisa estar dentro de <BarcodeProvider>.');
  }
  return context;
}

/**
 * Declara que este componente sabe tratar leituras no contexto `ctx`.
 *
 * O `handler` e guardado em ref: nao precisa ser memoizado, e e a forma
 * correta de nao religar a pilha a cada render. Componentes acima na
 * pilha (ex.: a listagem) continuam registrados, mas nao recebem a
 * leitura enquanto este estiver no topo.
 */
export function useBarcodeHandler(
  ctx: BarcodeContextId,
  handler: (result: ScanResult) => void | Promise<void>,
  active = true,
): void {
  const { register } = useBarcodeManager();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    return register(ctx, (result) => handlerRef.current(result));
  }, [ctx, active, register]);
}

/** Atalho para a tela de diagnostico do leitor. */
export function useBarcodeDiagnostics() {
  const { lastRead, lastResult, stats, enabled, setEnabled, simulate, reset, context } =
    useBarcodeManager();
  return { lastRead, lastResult, stats, enabled, setEnabled, simulate, reset, context };
}

export { normalizeBarcode, isValidCheckDigit, isPlausibleBarcode } from './detector';

/**
 * Alerta visual de leitura. A tela pode montar este componente para
 * confirmar o bip visualmente, util quando o audio esta mudo (balcao com
 * ruido) ou bloqueado pelo navegador: o operador ve a faixa verde ou
 * vermelha no topo sem precisar olhar o toast.
 */
export function ScanFlash({ result }: { result: ScanResult | null }) {
  if (!result) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-50 h-1',
        result.found ? 'bg-success' : 'bg-destructive',
      )}
    />
  );
}
