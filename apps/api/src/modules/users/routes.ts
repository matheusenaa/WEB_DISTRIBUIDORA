import type { FastifyInstance } from 'fastify';
import {
  createUserSchema,
  updateUserSchema,
  paginationSchema,
  permissionsForRole,
  type SessionUser,
  type Role,
} from '@webdist/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { recordAudit } from '../../lib/audit.js';
import type { AuthUser } from '../../plugins/auth.js';

const listQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  role: z.enum(['ADMIN', 'VENDEDOR']).optional(),
  status: z.enum(['ATIVO', 'BLOQUEADO']).optional(),
});

const selectUser = {
  id: true,
  name: true,
  username: true,
  email: true,
  role: true,
  status: true,
  lastAccessAt: true,
  createdAt: true,
} as const;

function toDTO(user: {
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

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  /* Lista usuarios - apenas admin */
  app.get('/', { preHandler: [app.requirePermission('users:read')] }, async (request) => {
    const query = listQuerySchema.parse(request.query ?? {});
    const where: Record<string, unknown> = {};

    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search } },
        { username: { contains: query.search } },
        { email: { contains: query.search } },
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: selectUser,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    return {
      data: users.map(toDTO),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.perPage)),
      },
    };
  });

  /* Obter usuario */
  app.get('/:id', { preHandler: [app.requirePermission('users:read')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const user = await prisma.user.findUnique({ where: { id }, select: selectUser });
    if (!user) throw new AppError('NOT_FOUND', 'Usuario nao encontrado.');
    return toDTO(user);
  });

  /* Criar usuario */
  app.post('/', { preHandler: [app.requirePermission('users:create')] }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        username: input.username,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        status: 'ATIVO',
      },
      select: selectUser,
    });

    const actor = request.currentUser as AuthUser;
    await recordAudit(
      {
        userId: actor.id,
        userName: actor.username,
        action: 'CREATE',
        entity: 'User',
        entityId: user.id,
        description: `${actor.name} criou o usuario ${user.name} (${user.username}) - perfil ${user.role}`,
        after: { ...toDTO(user), password: '[REDACTED]' },
        request,
      },
    );

    return reply.status(201).send(toDTO(user));
  });

  /* Atualizar usuario */
  app.patch('/:id', { preHandler: [app.requirePermission('users:update')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const input = updateUserSchema.parse(request.body);
    const actor = request.currentUser as AuthUser;

    const before = await prisma.user.findUnique({ where: { id }, select: selectUser });
    if (!before) throw new AppError('NOT_FOUND', 'Usuario nao encontrado.');

    // Trava de seguranca: nao permitir remover o ultimo administrador ativo.
    const losingAdmin =
      (input.role !== undefined && input.role !== 'ADMIN' && before.role === 'ADMIN') ||
      (input.status !== undefined && input.status !== 'ATIVO' && before.role === 'ADMIN');

    if (losingAdmin) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ATIVO' } });
      if (activeAdmins <= 1) {
        throw new AppError(
          'CONFLICT',
          'Nao e possivel alterar este administrador: ele e o unico administrador ativo.',
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.role !== undefined) data.role = input.role;
    if (input.status !== undefined) data.status = input.status;
    if (input.password !== undefined) data.passwordHash = await hashPassword(input.password);

    const user = await prisma.user.update({ where: { id }, data, select: selectUser });

    // Bloqueio/alteracao de perfil encerra as sessoes ativas.
    if (input.status === 'BLOQUEADO' || input.role !== undefined || input.password !== undefined) {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const changes: string[] = [];
    if (input.name !== undefined && input.name !== before.name) changes.push(`nome para "${input.name}"`);
    if (input.role !== undefined && input.role !== before.role)
      changes.push(`perfil de ${before.role} para ${input.role}`);
    if (input.status !== undefined && input.status !== before.status)
      changes.push(`status de ${before.status} para ${input.status}`);
    if (input.email !== undefined && input.email !== before.email) changes.push('e-mail');
    if (input.password !== undefined) changes.push('senha (redefinida)');

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      description:
        changes.length > 0
          ? `${actor.name} atualizou o usuario ${before.name}: ${changes.join(', ')}`
          : `${actor.name} atualizou o usuario ${before.name}`,
      before,
      after: { ...toDTO(user), password: input.password ? '[REDACTED]' : undefined },
      request,
    });

    return toDTO(user);
  });

  /* Bloquear / desbloquear */
  app.post('/:id/status', { preHandler: [app.requirePermission('users:update')] }, async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { status } = z.object({ status: z.enum(['ATIVO', 'BLOQUEADO']) }).parse(request.body);
    const actor = request.currentUser as AuthUser;

    if (id === actor.id && status === 'BLOQUEADO') {
      throw new AppError('CONFLICT', 'Voce nao pode bloquear o proprio usuario.');
    }

    const before = await prisma.user.findUnique({ where: { id }, select: selectUser });
    if (!before) throw new AppError('NOT_FOUND', 'Usuario nao encontrado.');

    if (status !== 'ATIVO' && before.role === 'ADMIN') {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', status: 'ATIVO' } });
      if (activeAdmins <= 1) {
        throw new AppError(
          'CONFLICT',
          'Nao e possivel bloquear este administrador: ele e o unico administrador ativo.',
        );
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status },
      select: selectUser,
    });

    if (status === 'BLOQUEADO') {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      description: `${actor.name} ${status === 'BLOQUEADO' ? 'bloqueou' : 'desbloqueou'} o usuario ${before.name}`,
      before,
      after: toDTO(user),
      request,
    });

    return toDTO(user);
  });

  /* Deletar usuario (fisico). Historico de vendas permanece via onDelete Restrict,
     portanto a API bloqueia exclusao de usuarios com historico. */
  app.delete('/:id', { preHandler: [app.requirePermission('users:delete')] }, async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const actor = request.currentUser as AuthUser;

    if (id === actor.id) {
      throw new AppError('CONFLICT', 'Voce nao pode excluir o proprio usuario.');
    }

    const before = await prisma.user.findUnique({ where: { id }, select: selectUser });
    if (!before) throw new AppError('NOT_FOUND', 'Usuario nao encontrado.');

    const [saleCount, movementCount, cashCount] = await Promise.all([
      prisma.sale.count({ where: { OR: [{ sellerId: id }, { userId: id }] } }),
      prisma.stockMovement.count({ where: { userId: id } }),
      prisma.cashSession.count({ where: { userId: id } }),
    ]);

    if (saleCount > 0 || movementCount > 0 || cashCount > 0) {
      throw new AppError(
        'CONFLICT',
        'Este usuario possui historico de operacoes e nao pode ser excluido. Use o bloqueio.',
        { saleCount, movementCount, cashCount },
      );
    }

    await prisma.user.delete({ where: { id } });

    await recordAudit({
      userId: actor.id,
      userName: actor.username,
      action: 'DELETE',
      entity: 'User',
      entityId: id,
      description: `${actor.name} excluiu o usuario ${before.name} (${before.username})`,
      before: toDTO(before),
      request,
    });

    return reply.send({ ok: true });
  });
}
