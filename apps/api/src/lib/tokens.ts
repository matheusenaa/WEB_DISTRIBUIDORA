import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Role } from '@webdist/shared';
import { config } from '../env.js';
import { AppError } from './errors.js';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);
const ISSUER = 'web-distribuidora';
const AUDIENCE = 'web-distribuidora-app';

export interface AccessTokenPayload {
  sub: number;
  username: string;
  role: Role;
  type: 'access';
}

const DURATION_UNITS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

type DurationUnit = keyof typeof DURATION_UNITS;

export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)\s*([smhdw])$/.exec(duration.trim());
  if (!match) throw new Error(`Duracao invalida: ${duration}`);
  const value = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return value * DURATION_UNITS[unit];
}

export const accessTokenTtlMs = () => parseDurationToMs(config.JWT_ACCESS_TTL);
export const refreshTokenTtlMs = () => parseDurationToMs(config.JWT_REFRESH_TTL);

export async function signAccessToken(input: {
  userId: number;
  username: string;
  role: Role;
}): Promise<string> {
  const ttl = accessTokenTtlMs();
  return new SignJWT({ username: input.username, role: input.role, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(input.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + Math.floor(ttl / 1000))
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (payload.type !== 'access') throw new AppError('TOKEN_INVALID', 'Token invalido.');
    const sub = Number(payload.sub);
    if (!Number.isInteger(sub) || sub <= 0) throw new AppError('TOKEN_INVALID', 'Token invalido.');
    return {
      sub: sub,
      username: String(payload.username ?? ''),
      role: payload.role as Role,
      type: 'access',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError('TOKEN_EXPIRED', 'Sua sessao expirou. Entre novamente.');
    }
    throw new AppError('TOKEN_INVALID', 'Token invalido. Entre novamente.');
  }
}

/* ------------------------------------------------------------------ */
/* Refresh tokens                                                      */
/* ------------------------------------------------------------------ */

const pepper = () => config.REFRESH_TOKEN_PEPPER;

/** Gera token opaco de alta entropia (nao e JWT, nao carrega dados). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Armazena apenas o SHA-256 do token: vazamento do banco nao expoe sessoes. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(`${token}${pepper()}`).digest('hex');
}

export function refreshTokenMatches(token: string, storedHash: string): boolean {
  const computed = Buffer.from(hashRefreshToken(token), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + refreshTokenTtlMs());
}
