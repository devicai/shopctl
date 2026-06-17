/**
 * client.ts — Wrapper de fetch sobre la API de DummyJSON.
 *
 * Responsabilidades:
 *  - Resolver la base URL (config/precedencia, patrón #7): SHOPCTL_BASE_URL
 *    en el entorno, con default https://dummyjson.com.
 *  - Distinguir errores de RED (DNS, timeout, conexión rechazada) de errores
 *    HTTP de la API. Esto importa para los exit codes (patrón #6): un fallo de
 *    red es recuperable/transitorio (code 5) y un 4xx es un error de uso (1).
 *  - Cachear localmente la lista de categorías (se usa en validación, patrón #5).
 */

import { EXIT } from './exit.js';

export const BASE_URL = process.env.SHOPCTL_BASE_URL?.replace(/\/$/, '') || 'https://dummyjson.com';

/** Error de red: el host no respondió. Lo mapeamos a exit code 5. */
export class NetworkError extends Error {
  readonly code = 'NETWORK_ERROR';
  readonly exitCode = EXIT.NETWORK;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

/** Error HTTP de la API (4xx/5xx). Exit code 1 (error genérico). */
export class ApiError extends Error {
  readonly code = 'API_ERROR';
  readonly exitCode = EXIT.ERROR;
  constructor(message: string, readonly statusCode: number, readonly body?: unknown) {
    super(message);
  }
}

interface RequestOpts {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** GET/POST/PUT/DELETE genérico contra DummyJSON. Devuelve el JSON parseado. */
export async function request<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // fetch sólo rechaza por fallos de red/transporte, nunca por status HTTP.
    throw new NetworkError(`No se pudo conectar con ${url.host}`, err);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const fromBody =
      data && typeof data === 'object' && 'message' in data ? String((data as any).message) : '';
    const apiMsg = fromBody || `${res.status} ${res.statusText}`;
    throw new ApiError(apiMsg, res.status, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Cache local de categorías (alimenta la validación) ───────────────────────

let categoriesCache: string[] | undefined;

/**
 * Lista de categorías válidas, cacheada en memoria por proceso.
 * Es el "enum" del dominio que usamos para validar --category SIN llamar a la
 * API de escritura con datos inválidos (patrón #5: lógica de negocio en la CLI).
 */
export async function getCategories(): Promise<string[]> {
  if (categoriesCache) return categoriesCache;
  categoriesCache = await request<string[]>('/products/category-list');
  return categoriesCache;
}
