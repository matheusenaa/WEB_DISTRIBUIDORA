/**
 * DETECCAO DE LEITURA DE CODIGO DE BARRAS (USB / HID / Keyboard Wedge)
 *
 * Como funciona o hardware
 * ------------------------
 * A grande maioria dos leitores USB e Bluetooth de barcode NAO expoe um
 * evento de "codigo de barras" para a Web API. Eles operam em modo
 * *keyboard wedge*: o firmware do leitor injeta os caracteres como se
 * fossem teclas digitadas e envia `Enter` no final. E por isso que nao
 * existe `BarcodeDetector` na plataforma.
 *
 * Como o sistema distingue leitor de digitacao humana
 * ---------------------------------------------------
 * Unico criterio confiavel: o RITMO. Um leitor entrega 13 caracteres em
 * poucos milissegundos; uma pessoa digita em 30-150 ms por tecla. A
 * distincao e feita por tres sinais combinados:
 *
 *   1. intervalo medio entre caracteres < MAX_KEY_GAP_MS;
 *   2. comprimento minimo (protege contra o Enter de um clique);
 *   3. `Enter` imediatamente apos o ultimo caractere.
 *
 * Por que a digitacao manual NAO passa por aqui
 * ---------------------------------------------
 * Uma pessoa digita mais devagar que o limiar, entao o detector acima
 * nunca dispara para digitacao humana - e correto, senao cada tecla
 * digitada no formulario viraria "leitura". O requisito de digitacao
 * manual e resolvido em outra camada: o `BarcodeProvider` marca os
 * campos com `data-barcode-input` e trata o `Enter` como submissao
 * explicita. Os dois caminhos convergem no mesmo `handleScan()`.
 */

/** Intervalo maximo entre teclas para considerar leitura de leitor (ms). */
export const MAX_KEY_GAP_MS = 45;
/** Leitura com menos caracteres que isso e descartada. */
export const MIN_LENGTH = 4;
/** Tempo sem tecla que encerra o buffer (ms). */
export const RESET_TIMEOUT_MS = 220;
/** Intervalo maximo entre o ultimo caractere e o Enter (ms). */
export const MAX_ENTER_GAP_MS = 120;

export interface DetectedRead {
  code: string;
  /** Caracteres capturados. */
  charCount: number;
  /** Duracao total da leitura em ms. */
  durationMs: number;
  /** Intervalo medio entre caracteres, em ms. */
  averageGapMs: number;
}

export interface DetectorOptions {
  onRead: (read: DetectedRead) => void;
  /** Permite desligar a captura (ex.: enquanto um dialogo bloqueante abre). */
  enabled: boolean;
}

export interface Detector {
  /** Zera o buffer. Use ao trocar de tela para nao vazar leitura antiga. */
  reset: () => void;
  /** Remove o listener de window. Deve ser chamado no cleanup do hook. */
  destroy: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Captura global de teclas em fase de CAPTURA (`true`), para rodar antes
 * de qualquer handler da aplicacao. Nao previne propagacao: apenas
 * observa. O `preventDefault` so acontece no ENTER de uma leitura
 * confirmada, para o Enter do scanner nao recarregar a pagina nem
 * disparar o submit de um formulario que a tela nao pediu.
 */
export function createBarcodeDetector({ onRead, enabled }: DetectorOptions): Detector {
  let buffer = '';
  let lastKeyTime = 0;
  let firstKeyTime = 0;
  let gapTotal = 0;
  let resetTimer: number | null = null;
  // Flag explicito de "ha leitura em andamento".
  // Nao usar `lastKeyTime === 0` como sentinela: `performance.now()` pode
  // valer 0 legitimamente logo no primeiro ciclo, e isso descartaria o
  // primeiro caractere lido.
  let hasPending = false;

  const clearTimer = () => {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  const reset = () => {
    buffer = '';
    lastKeyTime = 0;
    firstKeyTime = 0;
    gapTotal = 0;
    hasPending = false;
    clearTimer();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!enabled) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const target = event.target as HTMLElement | null;

    // Campo marcado como entrada de codigo: o `Enter` e submissao
    // explicita do operador, nao uma leitura. O Provider trata esse
    // caminho; aqui apenas nao interferimos.
    if (isEditableTarget(target)) return;

    const now = performance.now();

    if (event.key === 'Enter') {
      const code = buffer;
      const charCount = code.length;
      // Media dos intervalos medidos entre caracteres consecutivos.
      const averageGapMs = charCount > 1 ? gapTotal / (charCount - 1) : 0;
      const enterGap = hasPending ? now - lastKeyTime : Number.POSITIVE_INFINITY;

      if (
        charCount >= MIN_LENGTH &&
        enterGap <= MAX_ENTER_GAP_MS &&
        averageGapMs <= MAX_KEY_GAP_MS
      ) {
        event.preventDefault();
        reset();
        onRead({
          code,
          charCount,
          durationMs: Math.round(now - firstKeyTime),
          averageGapMs: Number(averageGapMs.toFixed(1)),
        });
        return;
      }

      reset();
      return;
    }

    if (event.key.length !== 1) return;

    const gap = now - lastKeyTime;
    // Quebra de ritmo: comecou uma nova sequencia, descarta a anterior.
    if (!hasPending || gap > MAX_KEY_GAP_MS) {
      buffer = event.key;
      firstKeyTime = now;
      gapTotal = 0;
    } else {
      buffer += event.key;
      gapTotal += gap;
    }
    lastKeyTime = now;
    hasPending = true;

    clearTimer();
    resetTimer = window.setTimeout(reset, RESET_TIMEOUT_MS);
  };

  window.addEventListener('keydown', onKeyDown, true);

  return {
    reset,
    destroy: () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearTimer();
    },
  };
}

/**
 * Remove o que leitores e sistemas de PDV escondem sob o pano.
 * Mantem letras e digitos porque codigo interno costuma ser alfanumerico.
 */
export function normalizeBarcode(input: string): string {
  return input.replace(/[^\dA-Za-z-]/g, '').trim();
}

/** EAN-8, EAN-13, UPC-A e codigos internos alfanumericos. */
export function isPlausibleBarcode(code: string): boolean {
  const clean = normalizeBarcode(code);
  return /^\d{8}$|^\d{12,14}$|^[A-Za-z0-9-]{6,20}$/.test(clean);
}

/**
 * Confere o digito verificador de EAN-8 / EAN-13 / UPC-A.
 * Retorna true quando o codigo nao e numerico (digito verificador
 * nao se aplica a codigo interno).
 */
export function isValidCheckDigit(code: string): boolean {
  const clean = normalizeBarcode(code);
  if (!/^\d{8}$|^\d{12,13}$|^\d{14}$/.test(clean)) return true;

  const digits = clean.split('').map(Number);
  const body = digits.slice(0, -1);
  const check = digits[digits.length - 1]!;

  // EAN-8 comeca pesando 3; EAN-13/UPC comeca pesando 1.
  const startWeight = body.length === 7 ? 3 : 1;
  let sum = 0;
  body.forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? startWeight : 4 - startWeight);
  });
  return (10 - (sum % 10)) % 10 === check;
}
