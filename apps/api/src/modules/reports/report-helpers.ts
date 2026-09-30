/**
 * Ajudantes compartilhados pelos modulos de relatorio.
 *
 * Existe em arquivo proprio para que os relatorios nao dependam do modulo de
 * dashboard e o contrario: o calculo de intervalo e util, mas nao e regra de
 * negocio do dashboard.
 */
import { centsToBRL } from '@webdist/shared';

export { centsToBRL };

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Intervalo padrao dos relatorios: ultimos 30 dias quando o usuario nao
 * informa datas. Nunca retorna intervalo invertido.
 */
export function resolveRangeLocal(
  from: Date | undefined,
  to: Date | undefined,
  now = new Date(),
): { from: Date; to: Date } {
  if (from && to) {
    const start = startOfDay(from) < startOfDay(to) ? startOfDay(from) : startOfDay(to);
    const end = endOfDay(from) > endOfDay(to) ? endOfDay(from) : endOfDay(to);
    return { from: start, to: end };
  }
  if (from && !to) {
    return { from: startOfDay(from), to: endOfDay(now) };
  }
  if (!from && to) {
    const start = new Date(to);
    start.setDate(start.getDate() - 29);
    return { from: startOfDay(start), to: endOfDay(to) };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { from: startOfDay(start), to: endOfDay(now) };
}
