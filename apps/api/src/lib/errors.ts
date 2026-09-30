/**
 * Erros de aplicacao.
 *
 * Divisao de responsabilidades (regra do projeto):
 *  - `message` -> mensagem AMIGAVEL mostrada ao usuario final.
 *  - `details` -> contexto tecnico, gravado somente no log do servidor.
 * O handler nunca expoe stack trace nem mensagem de banco ao cliente.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STOCK_INSUFFICIENT'
  | 'STOCK_NEGATIVE_BLOCKED'
  | 'DISCOUNT_EXCEEDED'
  | 'CASH_ALREADY_OPEN'
  | 'CASH_NOT_OPEN'
  | 'CASH_NOT_FOUND'
  | 'SALE_ALREADY_CANCELED'
  | 'OPERATION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STOCK_INSUFFICIENT: 409,
  STOCK_NEGATIVE_BLOCKED: 409,
  DISCOUNT_EXCEEDED: 403,
  CASH_ALREADY_OPEN: 409,
  CASH_NOT_OPEN: 409,
  CASH_NOT_FOUND: 404,
  SALE_ALREADY_CANCELED: 409,
  OPERATION_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
    this.expose = this.statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const notFound = (what = 'Registro') => new AppError('NOT_FOUND', `${what} nao encontrado.`);

export const conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, details);

export const forbidden = (message = 'Voce nao tem permissao para esta operacao.') =>
  new AppError('FORBIDDEN', message);

export const operationFailed = (message: string, details?: unknown) =>
  new AppError('OPERATION_FAILED', message, details);
