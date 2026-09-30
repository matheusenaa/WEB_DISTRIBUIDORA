import type { FastifyRequest } from 'fastify';

/** IP real do cliente, respeitando proxies. */
export function clientIp(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 45);
  }
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0].slice(0, 45);
  return request.ip ?? null;
}

export function userAgent(request: FastifyRequest): string | null {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 400) : null;
}
