import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { type Permission, permissionsForRole, isRole } from '@webdist/shared';
import { config } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'VENDEDOR';
  status: 'ATIVO' | 'BLOQUEADO';
  permissions: readonly Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido por `request.user` apos autenticacao. */
    currentUser: AuthUser | null;
    /** Token de acesso bruto, usado para logout/blacklist. */
    accessToken: string | null;
  }
  interface FastifyInstance {
    /** Exige autenticacao + uma ou mais permissoes. Usar como preHandler. */
    requirePermission(...permissions: Permission[]): (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return config.publicRoutes.some((route) => path === route || path.startsWith(`${route}/`));
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('accessToken', null);

  // Autentica toda requisicao (exceto rotas publicas) e popula request.currentUser.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    if (isPublicRoute(request.url)) return;

    const token = extractBearer(request);
    if (!token) {
      throw new AppError('UNAUTHENTICATED', 'Faca login para continuar.');
    }
    request.accessToken = token;

    const payload = await verifyAccessToken(token);

    // Reconsulta o usuario: garante que bloqueio/alteracao de perfil tenha
    // efeito imediato, sem esperar o token expirar.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) throw new AppError('UNAUTHENTICATED', 'Usuario nao encontrado. Entre novamente.');
    if (user.status !== 'ATIVO') {
      throw new AppError('FORBIDDEN', 'Seu acesso esta bloqueado. Procure o administrador.');
    }
    if (!isRole(user.role)) {
      throw new AppError('FORBIDDEN', 'Perfil de acesso invalido.');
    }

    request.currentUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: permissionsForRole(user.role),
    };
  });

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser) {
      throw new AppError('UNAUTHENTICATED', 'Faca login para continuar.');
    }
  });

  app.decorate(
    'requirePermission',
    (...permissions: Permission[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        const user = request.currentUser;
        if (!user) throw new AppError('UNAUTHENTICATED', 'Faca login para continuar.');

        // ADMIN tem todas as permissoes por construcao; ainda assim a
        // verificacao abaixo mantem o codigo seguro caso o mapa mude.
        const allowed = permissions.every((p) => user.permissions.includes(p));
        if (!allowed) {
          throw new AppError(
            'FORBIDDEN',
            'Voce nao tem permissao para esta operacao.',
            { required: permissions, role: user.role },
          );
        }
      },
  );
});
