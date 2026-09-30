import { centsToBRL } from '@webdist/shared';
import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export { centsToBRL };

/** Formata centavos como moeda pt-BR, com prefixo. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return 'R$ 0,00';
  return `R$ ${centsToBRL(cents)}`;
}

/** Igual a money(), mas sem prefixo, para usar dentro de celulas de tabela. */
export function moneyPlain(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '0,00';
  return centsToBRL(cents);
}

/** Quantidade: remove casas decimais zeradas, ex.: 3.000 -> "3.000", 2.5 -> "2,5" */
export function qty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
}

/** Quantidade com unidade, ex.: 12 UN */
export function qtyUnit(value: number, unit: string): string {
  return `${qty(value)} ${unit}`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function dateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }) : '-';
}

export function dateOnly(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : '-';
}

export function timeOnly(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'HH:mm', { locale: ptBR }) : '-';
}

/** "ha 5 minutos" */
export function relative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '-';
  return `${formatDistanceToNowStrict(date, { locale: ptBR })} atras`;
}

/** Percentual ja vindo do backend, com 1 casa. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}

/** "1.234" a partir de um inteiro (vendas, itens). */
export function integer(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('pt-BR').format(value);
}

/** Iniciais para o avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}