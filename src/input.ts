/**
 * input.ts — Inputs desde archivos y stdin (patrón #4).
 *
 * Un agente raramente teclea flags uno a uno; construye un objeto y lo manda.
 * Por eso toda operación de escritura acepta `--from-json <ruta>` y, con `-`,
 * lee de stdin. Eso permite:  `cat product.json | shopctl products create --from-json -`
 *
 * Respeto a no-TTY (patrón #6): si piden leer de stdin pero NO hay nada pipeado
 * (stdin es un TTY interactivo), NO nos quedamos colgados esperando: fallamos
 * con un mensaje claro. Una CLI agent-native nunca cuelga esperando un humano.
 */

import { readFileSync } from 'node:fs';
import { EXIT } from './exit.js';

export class InputError extends Error {
  readonly code = 'INPUT_ERROR';
  readonly exitCode = EXIT.USAGE;
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

function readStdinSync(): string {
  if (process.stdin.isTTY) {
    throw new InputError(
      'Se pidió leer JSON de stdin (-) pero no hay nada pipeado.',
      'Pásalo así: cat product.json | shopctl products create --from-json -',
    );
  }
  try {
    return readFileSync(0, 'utf-8'); // fd 0 = stdin
  } catch {
    return '';
  }
}

/**
 * Resuelve el JSON de entrada de `--from-json`.
 * @param source  ruta a un fichero, o '-' para stdin.
 */
export function readJsonInput(source: string): Record<string, unknown> {
  const raw = source === '-' ? readStdinSync() : readFileSync(source, 'utf-8');
  if (!raw.trim()) {
    throw new InputError('La entrada JSON está vacía.');
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new InputError('El JSON debe ser un objeto.');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError(
      `JSON inválido en ${source === '-' ? 'stdin' : source}: ${(err as Error).message}`,
      'Revisa que el fichero contenga JSON bien formado.',
    );
  }
}
