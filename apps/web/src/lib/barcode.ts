import { useCallback, useEffect, useRef } from 'react';

/**
 * Leitura de codigo de barras SEM plugin de navegador.
 *
 * Almost todos os leitores USB/Bluetooth operam em modo "keyboard wedge":
 * o hardware digita os caracteres muito rapido e envia Enter no final.
 * Isso significa que nao ha evento "de codigo de barras" na Web API:
 * precisamos inferir a leitura pela VELOCIDADE das teclas.
 *
 * Criterios usados (ajustaveis por parametro):
 *  - pelo menos MIN_LENGTH caracteres;
 *  - intervalo medio entre teclas menor que MAX_KEY_GAP_MS;
 *  - Enter logo apos o ultimo caractere.
 *
 * Uma digitacao humana normal (30-150 ms entre teclas) nunca sera
 * confundida com leitura, e o numero minimo de caracteres protege
 * contra o Enter acidental de um clique.
 */

/** Intervalo maximo entre teclas para considerar leitura de leitor (ms). */
const MAX_KEY_GAP_MS = 45;
/** Leitura com menos caracteres que isso e descartada. */
const MIN_LENGTH = 4;
/** Tempo sem tecla que encerra o buffer (ms). */
const RESET_TIMEOUT_MS = 220;

export interface BarcodeScannerOptions {
  /** Chamado quando uma leitura e detectada. */
  onScan: (code: string) => void;
  /** Desliga a captura global (ex.: enquanto um modal esta aberto). */
  enabled?: boolean;
}

export interface BarcodeScanner {
  /** Zera o buffer manualmente (ex.: apos cancelar uma venda). */
  reset: () => void;
}

export function useBarcodeScanner({ onScan, enabled = true }: BarcodeScannerOptions): BarcodeScanner {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const onScanRef = useRef(onScan);

  // Mantem o callback atualizado sem religar o listener a cada render.
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const reset = useCallback(() => {
    bufferRef.current = '';
    lastKeyTimeRef.current = 0;
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    const clearTimer = () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };

    const scheduleReset = () => {
      clearTimer();
      resetTimerRef.current = window.setTimeout(() => {
        bufferRef.current = '';
      }, RESET_TIMEOUT_MS);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      // Campo de texto comum: nao interceptamos, para nao quebrar a digitacao.
      if (isEditable) return;

      const now = performance.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (event.key === 'Enter') {
        const code = bufferRef.current;
        bufferRef.current = '';
        clearTimer();
        // So tratamos como leitura se vier rapido E com conteudo suficiente.
        if (code.length >= MIN_LENGTH && gap > 0 && gap <= MAX_KEY_GAP_MS) {
          event.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (event.key.length !== 1) return;

      // Quebra de ritmo: recomeca o buffer (nova digitacao).
      if (gap > MAX_KEY_GAP_MS) bufferRef.current = '';

      bufferRef.current += event.key;
      scheduleReset();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      clearTimer();
    };
  }, [enabled, reset]);

  return { reset };
}

/**
 * Filtro para transformar o que o usuario digita em um codigo de barras
 * utilizavel, removendo o que leitores/POS mandam por baixo.
 */
export function normalizeBarcode(input: string): string {
  return input.replace(/[^\dA-Za-z-]/g, '').trim();
}

/** EAN-13, EAN-8, UPC-A e codigos com digito verificador de 13 digitos. */
export function isPlausibleBarcode(code: string): boolean {
  const clean = normalizeBarcode(code);
  return /^\d{8}$|^\d{12,14}$|^[A-Za-z0-9-]{6,20}$/.test(clean);
}

/**
 * Confere o digito verificador de EAN-13/UPC/EAN-8.
 * Retorna true quando o codigo nao e numerico (ex.: codigo interno).
 */
export function isValidCheckDigit(code: string): boolean {
  const clean = normalizeBarcode(code);
  if (!/^\d{8}$|^\d{12,13}$|^\d{14}$/.test(clean)) return true; // nao numerico: nao aplicavel

  const digits = clean.split('').map(Number);
  const body = digits.slice(0, -1);
  const check = digits[digits.length - 1]!;

  // EAN-8 usa peso 3,4,3,4... (o primeiro digito pesa 3).
  const startWeight = body.length === 7 ? 3 : 1;
  let sum = 0;
  body.forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? startWeight : 4 - startWeight);
  });
  return (10 - (sum % 10)) % 10 === check;
}