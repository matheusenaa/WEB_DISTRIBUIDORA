import type { FastifyInstance } from 'fastify';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  permissionsForRole,
  type LoginResponse,
  type RefreshResponse,
  type SessionUser,
  type AuthTokens,
  type Role,
} from '@webdist/shared';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  accessTokenTtlMs,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  refreshTokenMatches,
  signAccessToken,
} from '../../lib/tokens.js';
import { recordAudit } from '../../lib/audit.js';
import { clientIp, userAgent } from '../../lib/request-meta.js';
import type { AuthUser } from '../../plugins/auth.js';

const GENERIC_LOGIN_ERROR = 'Usuario ou senha incorretos.';

/** Resposta de login igual para usuario inexistente e senha errada. */
function toSessionUser(user: {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  status: string;
  lastAccessAt: Date | null;
  createdAt: Date;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role as Role,
    status: user.status as SessionUser['status'],
    permissions: permissionsForRole(user.role as Role),
    lastAccessAt: user.lastAccessAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueTokens(user: {
  id: number;
  username: string;
  role: string;
}, request: { ip?: string; headers: Record<string, unknown> }): Promise<AuthTokens> {
  const accessToken = await signAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role as Role,
  });
  const refreshToken = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 400) : null,
      ip: request.ip ?? null,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: Math.floor(accessTokenTtlMs() / 1000),
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /* -------------------------------------------------------------- */
  /* POST /api/auth/login                                           */
  /* -------------------------------------------------------------- */
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { username, password } = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        lastAccessAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      // Gasta tempo parecido com um hash real para nao vazar quais usuarios
      // existem por diferenca de tempo de resposta.
      await verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
      await recordAudit({
        userName: username,
        action: 'LOGIN_FAILED',
        entity: 'User',
        description: `Tentativa de login com usuario inexistente: ${username}`,
        request,
      });
      throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await recordAudit({
        userId: user.id,
        userName: user.username,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        description: `Senha incorreta no login de ${user.username}`,
        request,
      });
      throw new AppError('INVALID_CREDENTIALS', GENERIC_LOGIN_ERROR);
    }

    if (user.status !== 'ATIVO') {
      throw new AppError('FORBIDDEN', 'Seu acesso esta bloqueado. Procure o administrador.');
    }

    const tokens = await issueTokens(user, request);
    await prisma.user.update({ where: { id: user.id }, data: { lastAccessAt: new Date() } });
    await recordAudit({
      userId: user.id,
      userName: user.username,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      description: `${user.name} entrou no sistema`,
      request,
    });

    const session = toSessionUser({ ...user, lastAccessAt: new Date() });
    const response: LoginResponse = { user: session, tokens };
    return reply.send(response);
  });

  /* -------------------------------------------------------------- */
  /* POST /api/auth/refresh (rotacao de token)                      */
  /* -------------------------------------------------------------- */
  app.post(
    '/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { refreshToken } = refreshSchema.parse(request.body);

      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              email: true,
              role: true,
              status: true,
              lastAccessAt: true,
              createdAt: true,
            },
          },
        },
      });

      if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
        throw new AppError('TOKEN_INVALID', 'Sua sessao expirou. Entre novamente.');
      }
      // Recusa token que foi revogado por logout, mesmo com hash correto.
      if (!refreshTokenMatches(refreshToken, stored.tokenHash)) {
        throw new AppError('TOKEN_INVALID', 'Sua sessao expirou. Entre novamente.');
      }
      if (stored.user.status !== 'ATIVO') {
        throw new AppError('FORBIDDEN', 'Seu acesso esta bloqueado. Procure o administrador.');
      }

      // Rotacao: o token usado e invalidado e um novo e emitido.
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });

      const tokens = await issueTokens(stored.user, request);
      const response: RefreshResponse = { user: toSessionUser(stored.user), tokens };
      return response;
    },
  );

  /* -------------------------------------------------------------- */
  /* POST /api/auth/logout                                          */
  /* -------------------------------------------------------------- */
  app.post('/logout', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const user = request.currentUser as AuthUser;
    const body = (request.body ?? {}) as { refreshToken?: string };

    if (body.refreshToken) {
      await prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          tokenHash: hashRefreshToken(body.refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }
    // Revoga todas as sessoes do usuario ao fazer logout.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await recordAudit({
      userId: user.id,
      userName: user.username,
      action: 'LOGOUT',
      entity: 'User',
      entityId: user.id,
      description: `${user.name} saiu do sistema`,
      request,
    });

    return reply.send({ ok: true });
  });

  /* -------------------------------------------------------------- */
  /* GET /api/auth/me                                               */
  /* -------------------------------------------------------------- */
  app.get('/me', { preHandler: [app.requireAuth] }, async (request) => {
    const user = request.currentUser as AuthUser;
    const full = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        lastAccessAt: true,
        createdAt: true,
      },
    });
    if (!full) throw new AppError('UNAUTHENTICATED', 'Usuario nao encontrado. Entre novamente.');
    return toSessionUser(full);
  });

  /* -------------------------------------------------------------- */
  /* POST /api/auth/change-password                                 */
  /* -------------------------------------------------------------- */
  app.post('/change-password', { preHandler: [app.requireAuth] }, async (request, reply) => {
    const user = request.currentUser as AuthUser;
    const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);

    const record = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, passwordHash: true },
    });
    if (!record) throw new AppError('UNAUTHENTICATED', 'Usuario nao encontrado.');

    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Senha atual incorreta.');
    }
    if (await verifyPassword(newPassword, record.passwordHash)) {
      throw new AppError('VALIDATION_ERROR', 'A nova senha deve ser diferente da atual.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Troca de senha revoga todas as sessoes existentes.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await recordAudit({
      userId: user.id,
      userName: user.username,
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      entityId: user.id,
      description: `${user.name} alterou a propria senha`,
      request,
    });

    return reply.send({ ok: true, message: 'Senha alterada. Entre novamente.' });
  });

  /* -------------------------------------------------------------- */
  /* PUT /api/auth/profile                                          */
  /* -------------------------------------------------------------- */
  app.put('/profile', { preHandler: [app.requireAuth] }, async (request) => {
    const user = request.currentUser as AuthUser;
    const body = (request.body ?? {}) as { name?: string; email?: string };

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
        ...(typeof body.email === 'string' && body.email.trim() ? { email: body.email.trim().toLowerCase() } : {}),
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
        lastAccessAt: true,
        createdAt: true,
      },
    });
    return toSessionUser(updated);
  });
}
