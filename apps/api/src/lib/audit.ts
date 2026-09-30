import type { FastifyRequest } from 'fastify';
import type { Tx } from './prisma.js';
import { prisma } from './prisma.js';

export interface AuditEntry {
  userId?: number | null;
  userName?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | number | null;
  description: string;
  before?: unknown;
  after?: unknown;
  request?: FastifyRequest;
}

/** Remove campos sensiveis antes de persistir o snapshot. */
function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const SENSITIVE = new Set(['passwordHash', 'password', 'newPassword', 'currentPassword', 'tokenHash']);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE.has(key)) continue;
    if (typeof val === 'bigint') {
      out[key] = val.toString();
      continue;
    }
    out[key] = redact(val);
  }
  return out;
}

function serialize(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '"[nao serializavel]"';
  }
}

/**
 * Grava um registro de auditoria.
 *
 * Nunca lanca excecao: falha de auditoria nao pode derrubar a operacao de
 * negocio que ja foi concluida. O erro e registrado no log do servidor.
 */
export async function recordAudit(
  entry: AuditEntry,
  client: Tx = prisma,
): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        userName: entry.userName ?? null,
        action: entry.action,
        entity: entry.entity ?? null,
        entityId:
          entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
        description: entry.description,
        before: serialize(entry.before),
        after: serialize(entry.after),
        ip: entry.request?.ip ?? null,
        userAgent: entry.request?.headers['user-agent']?.slice(0, 400) ?? null,
      },
    });
  } catch (err) {
    entry.request?.log.error({ err }, 'falha ao gravar log de auditoria');
  }
}

/** Compara dois objetos e devolve apenas os campos que mudaram. */
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const current = before[key];
    if (current instanceof Date && value instanceof Date) {
      if (current.getTime() !== value.getTime()) changed[key] = value;
      continue;
    }
    if (current instanceof Date || value instanceof Date) {
      changed[key] = value;
      continue;
    }
    if (current !== value) changed[key] = value;
  }
  return changed;
}
