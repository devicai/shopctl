/**
 * exit.ts — Exit codes estructurados (patrón #6).
 *
 * Un agente decide qué hacer a continuación leyendo el exit code, no parseando
 * texto. Por eso los códigos son estables y tienen semántica:
 *
 *   0  OK              — todo bien.
 *   1  ERROR           — error genérico de la operación (p.ej. 404 de la API).
 *   2  USAGE/VALIDATION— el INPUT es inválido: el agente debe corregir y reintentar.
 *   5  NETWORK         — fallo de red transitorio: reintentar con backoff puede ir bien.
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  NETWORK: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
