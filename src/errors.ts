/**
 * errors.ts — Salida y terminación con error estructurado (patrón #6).
 *
 * `fail()` es la forma canónica de abortar: imprime el error+hint en el formato
 * activo (a stderr) y termina con el exit code adecuado. Lanza para que el flujo
 * se corte ya en el sitio de la llamada; el index.ts captura como red de seguridad.
 */

import { emitError } from './output.js';
import { EXIT, type ExitCode } from './exit.js';

export interface FailSpec {
  error: string;
  code: string;
  hint?: string;
  statusCode?: number;
  exitCode?: ExitCode;
}

/** Error tipado que transporta su propio exit code y hint. */
export class CliError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly statusCode?: number;
  readonly exitCode: ExitCode;
  constructor(spec: FailSpec) {
    super(spec.error);
    this.code = spec.code;
    this.hint = spec.hint;
    this.statusCode = spec.statusCode;
    this.exitCode = spec.exitCode ?? EXIT.ERROR;
  }
}

/** Imprime el error y termina el proceso con el exit code indicado. */
export function fail(spec: FailSpec): never {
  emitError({ error: spec.error, code: spec.code, hint: spec.hint, statusCode: spec.statusCode });
  process.exit(spec.exitCode ?? EXIT.ERROR);
}
