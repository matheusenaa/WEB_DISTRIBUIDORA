import type { ApiErrorBody } from '@webdist/shared';

/**
 * Cliente HTTP da API.
 *
 * Responsabilidades:
 *  - anexar o token de acesso;
 *  - renovar o token de forma transparente quando expire (rotacao);
 *  - normalizar o erro da API em um `ApiError` com mensagem amigavel;
 *  - serializar renovacoes concorrentes (evita rajada de 401 em paralelo).
 */

const BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const ACCESS_KEY = 'wd.accessToken';
const REFRESH_KEY = 'wd.refreshToken';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody | null, fallbackMessage: string) {
    super(body?.error?.message ?? fallbackMessage);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId;
  }

  /** Lista de campos com problema, quando a API devolve erro de validacao. */
  get fieldIssues(): { path: string; message: string }[] {
    const details = this.details as { issues?: { path: string; message: string }[] } | undefined;
    return details?.issues ?? [];
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export const tokenStore = {
  get access(): string | null {
    try {
      return localStorage.getItem(ACCESS_KEY);
    } catch {
      return null;
    }
  },
  get refresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  set(access: string, refresh: string): void {
    try {
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* modo privado do navegador: segue apenas em memoria */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignora */
    }
  },
};

/** Disparado quando a sessao morre, para o app redirecionar ao login. */
export const SESSION_EXPIRED_EVENT = 'wd:session-expired';

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      tokens: { accessToken: string; refreshToken: string };
    };
    tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
    return true;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Nao tenta renovar o token (usado na propria rota de refresh). */
  skipRefresh?: boolean;
  signal?: AbortSignal;
  /** Resposta binaria (CSV, XLSX, download). */
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, skipRefresh = false, signal, raw = false } = options;

  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  };

  let response = await send(tokenStore.access);

  if (response.status === 401 && !skipRefresh && tokenStore.refresh) {
    // Serializa: varias chamadas em paralelo compartilham uma unica renovacao.
    refreshPromise = refreshPromise ?? refreshSession().finally(() => {
      refreshPromise = null;
    });
    const renewed = await refreshPromise;
    if (renewed) {
      response = await send(tokenStore.access);
    } else {
      tokenStore.clear();
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
  }

  if (raw) {
    if (!response.ok) {
      const text = await response.text();
      let parsed: ApiErrorBody | null = null;
      try {
        parsed = JSON.parse(text) as ApiErrorBody;
      } catch {
        /* corpo nao-JSON */
      }
      throw new ApiError(response.status, parsed, 'Nao foi possivel gerar o arquivo.');
    }
    return response as unknown as T;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { code: 'INVALID_RESPONSE', message: 'Resposta invalida do servidor.' } };
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, data as ApiErrorBody, 'Nao foi possivel completar a operacao.');
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'POST', body, query }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Baixa um arquivo protegido usando o token da sessao. */
export async function downloadFile(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
  fallbackName: string,
): Promise<void> {
  const response = (await request<Response>(path, { query, raw: true })) as unknown as Response;
  const blob = await response.blob();

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Libera a memoria do blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
