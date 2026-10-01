import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENTER_GAP_MS,
  MAX_KEY_GAP_MS,
  MIN_LENGTH,
  RESET_TIMEOUT_MS,
  createBarcodeDetector,
  isPlausibleBarcode,
  isValidCheckDigit,
  normalizeBarcode,
  type DetectedRead,
} from '../src/lib/barcode/detector';

/**
 * Testes do detector de codigo de barras.
 *
 * O detector decide, por RITMO de teclas, se o que chegou e um leitor ou
 * uma digitacao humana. Essa e a parte mais sensivel do sistema: um
 * limiar errado faz o operador perder venda no balcao (digitacao humana
 * tratada como leitura) ou bipar 50 produtos sem querer (leitor tratado
 * como digitacao). Por isso os limiares tem teste.
 */

let reads: DetectedRead[] = [];
let handler: ((event: KeyboardEvent) => void) | null = null;
let removed = false;

/** Simula uma tecla, controlando o relogio que o detector usa. */
function press(key: string, atMs: number, target?: unknown): void {
  if (!handler) throw new Error('detector nao registrado');
  handler({
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target,
    preventDefault: () => undefined,
  } as unknown as KeyboardEvent);
  vi.advanceTimersByTime(atMs);
}

const BODY = { tagName: 'BODY', isContentEditable: false };
const INPUT = { tagName: 'INPUT', isContentEditable: false };

describe('detector de leitor (keyboard wedge)', () => {
  beforeEach(() => {
    reads = [];
    removed = false;
    handler = null;
    vi.useFakeTimers();

    const addEventListener = vi.fn((_type: string, fn: (event: KeyboardEvent) => void) => {
      handler = fn;
    });
    const removeEventListener = vi.fn(() => {
      removed = true;
      handler = null;
    });

    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('detecta uma leitura real: teclas rapidas seguidas de Enter', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    // Leitor entrega 13 digitos com ~5ms entre eles, depois Enter.
    for (const digit of '7896004008912') press(digit, 5, BODY);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.code).toBe('7896004008912');
    expect(reads[0]!.charCount).toBe(13);
    // Ritmo de leitor: muito abaixo do limite de digitacao humana.
    expect(reads[0]!.averageGapMs).toBeLessThanOrEqual(MAX_KEY_GAP_MS);
  });

  it('ignora digitacao humana lenta (nao e leitura)', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    // 120ms por tecla: pessoa digitando normalmente.
    for (const char of 'acucar') press(char, 120, BODY);
    press('Enter', 120, BODY);

    expect(reads).toHaveLength(0);
  });

  it('ignora Enter sozinho, sem sequencia previa', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });
    press('Enter', 5, BODY);
    expect(reads).toHaveLength(0);
  });

  it('descarta sequencia curta demais', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    // "ab" + Enter: abaixo de MIN_LENGTH, nao pode ser codigo.
    press('a', 5, BODY);
    press('b', 5, BODY);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('nao captura teclas dentro de campo de texto editavel', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    // O operador esta digitando no campo de busca: nao pode ser captura.
    for (const digit of '7896004008912') press(digit, 5, INPUT);
    press('Enter', 5, INPUT);

    expect(reads).toHaveLength(0);
  });

  it('ignora atalhos com modificador (Ctrl+C, Alt+F4)', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    if (!handler) throw new Error('detector nao registrado');
    handler({
      key: '7',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      target: BODY,
      preventDefault: () => undefined,
    } as unknown as KeyboardEvent);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('zera o buffer apos o timeout sem tecla', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    for (const digit of '1234') press(digit, 5, BODY);
    // Pausa maior que RESET_TIMEOUT_MS: buffer deve ser descartado.
    vi.advanceTimersByTime(RESET_TIMEOUT_MS + 50);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('nao entrega leitura quando o Enter chega tarde demais', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    for (const digit of '7896004008912') press(digit, 5, BODY);
    // O operador demorou entre a ultima tecla e o Enter.
    vi.advanceTimersByTime(MAX_ENTER_GAP_MS + 100);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('aceita duas leituras consecutivas sem resíduo da anterior', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    for (const digit of '1111111111111') press(digit, 5, BODY);
    press('Enter', 5, BODY);
    for (const digit of '2222222222222') press(digit, 5, BODY);
    press('Enter', 5, BODY);

    expect(reads.map((r) => r.code)).toEqual(['1111111111111', '2222222222222']);
  });

  it('nao captura nada quando desativado', () => {
    createBarcodeDetector({ enabled: false, onRead: (r) => reads.push(r) });

    for (const digit of '7896004008912') press(digit, 5, BODY);
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('remove o listener do window ao destruir', () => {
    const detector = createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });
    detector.destroy();
    expect(removed).toBe(true);
    expect(handler).toBeNull();
  });

  it('reset() descarta o buffer em andamento', () => {
    const detector = createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    for (const digit of '1234') press(digit, 5, BODY);
    detector.reset();
    press('Enter', 5, BODY);

    expect(reads).toHaveLength(0);
  });

  it('nao dispara para teclas nao imprimiveis como Shift', () => {
    createBarcodeDetector({ enabled: true, onRead: (r) => reads.push(r) });

    press('Shift', 5, BODY);
    press('ArrowLeft', 5, BODY);
    press('Tab', 5, BODY);

    expect(reads).toHaveLength(0);
  });
});

describe('normalizeBarcode', () => {
  it('remove espacos e caracteres que leitores/POS injetam', () => {
    expect(normalizeBarcode(' 789 600 400 8912 ')).toBe('7896004008912');
    expect(normalizeBarcode('ABC-123')).toBe('ABC-123');
  });

  it('mantem letras e digitos de codigo interno', () => {
    expect(normalizeBarcode('SKU0001')).toBe('SKU0001');
  });
});

describe('isPlausibleBarcode', () => {
  it('aceita EAN-8, EAN-13, UPC-A e codigo interno', () => {
    expect(isPlausibleBarcode('7896004')).toBe(true);
    expect(isPlausibleBarcode('7896004008912')).toBe(true);
    expect(isPlausibleBarcode('ABC-123')).toBe(true);
  });

  it('rejeita sequencia curta demais para ser codigo', () => {
    expect(isPlausibleBarcode('123')).toBe(false);
  });
});

describe('isValidCheckDigit', () => {
  it('confere EAN-13 valido', () => {
    // 7896004008912 e um EAN-13 valido (acucar refil 1kg).
    expect(isValidCheckDigit('7896004008912')).toBe(true);
  });

  it('rejeita EAN-13 com digito alterado', () => {
    expect(isValidCheckDigit('7896004008913')).toBe(false);
  });

  it('confere EAN-8 valido', () => {
    // 96385074: EAN-8 valido.
    expect(isValidCheckDigit('96385074')).toBe(true);
  });

  it('considera valido codigo alfanumerico (digito nao se aplica)', () => {
    expect(isValidCheckDigit('SKU0001')).toBe(true);
  });
});

describe('limiares documentados', () => {
  it('mantem os valores citados na tela de diagnostico', () => {
    // A tela /teste-leitor exibe estes numeros; se mudarem, a tela mente.
    expect(MAX_KEY_GAP_MS).toBe(45);
    expect(MIN_LENGTH).toBe(4);
    expect(RESET_TIMEOUT_MS).toBe(220);
  });
});
