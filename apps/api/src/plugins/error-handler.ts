import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { config } from '../env.js';
import { AppError } from '../lib/errors.js';

interface ValidationIssue {
  path: string;
  message: string;
}

function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(raiz)',
    message: issue.message,
  }));
}

function fromPrismaError(error: Prisma.PrismaClientKnownRequestError): AppError | null {
  switch (error.code) {
    case 'P2002': {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join(', ')
        : String(error.meta?.target ?? '');
      if (target.includes('barcode')) {
        return new AppError('CONFLICT', 'Ja existe um produto com este codigo de barras.', { target });
      }
      if (target.includes('internalCode')) {
        return new AppError('CONFLICT', 'Ja existe um produto com este codigo interno.', { target });
      }
      if (target.includes('username')) {
        return new AppError('CONFLICT', 'Este nome de usuario ja esta em uso.', { target });
      }
      if (target.includes('email')) {
        return new AppError('CONFLICT', 'Este e-mail ja esta cadastrado.', { target });
      }
      if (target.includes('name')) {
        return new AppError('CONFLICT', 'Ja existe um registro com este nome.', { target });
      }
      return new AppError('CONFLICT', 'Ja existe um registro com estes dados.', { target });
    }
    case 'P2003':
      return new AppError('CONFLICT', 'Registro relacionado invalido ou inexistente.');
    case 'P2025':
      return new AppError('NOT_FOUND', 'Registro nao encontrado.');
    default:
      return null;
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, requestId, url: request.url }, 'erro interno');
      } else {
        request.log.info(
          { code: error.code, details: error.details, requestId, url: request.url },
          error.message,
        );
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.expose ? error.details : undefined,
          requestId,
        },
      });
    }

    if (error instanceof ZodError) {
      const issues = zodIssues(error);
      request.log.info({ issues, requestId, url: request.url }, 'validacao falhou');
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dados invalidos. Verifique os campos destacados.',
          details: { issues },
          requestId,
        },
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = fromPrismaError(error);
      if (mapped) {
        request.log.info(
          { code: error.code, requestId, url: request.url },
          'conflito de banco de dados',
        );
        return reply.status(mapped.statusCode).send({
          error: {
            code: mapped.code,
            message: mapped.message,
            requestId,
          },
        });
      }
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      request.log.error({ err: error, requestId, url: request.url }, 'consulta invalida');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Nao foi possivel concluir a operacao. Tente novamente.',
          requestId,
        },
      });
    }

    // Rate limit do @fastify/rate-limit
    const anyError = error as { statusCode?: number; code?: string };
    if (anyError.code === 'FST_ERR_RATE_LIMIT' || anyError.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
          requestId,
        },
      });
    }

    // Erro de parse do corpo da requisicao
    if (anyError.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || anyError.statusCode === 415) {
      return reply.status(415).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Formato de envio invalido.',
          requestId,
        },
      });
    }

    // Log com contexto completo; resposta ao usuario nunca vaza detalhe tecnico.
    request.log.error(
      {
        err: error,
        requestId,
        url: request.url,
        method: request.method,
        userId: request.currentUser?.id ?? null,
        user: request.currentUser?.username ?? null,
      },
      'erro nao tratado',
    );

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocorreu um erro inesperado. Nossa equipe foi notificada.',
        requestId,
        ...(config.isProduction
          ? {}
          : { details: { message: error instanceof Error ? error.message : String(error) } }),
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Recurso nao encontrado.',
        requestId: request.id,
      },
    });
  });
}
