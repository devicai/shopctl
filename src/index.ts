#!/usr/bin/env node
/**
 * index.ts — Entrypoint de shopctl.
 *
 * Una CLI agent-native de demo sobre la API pública de DummyJSON.
 * Registra los grupos noun-verb (patrón #1) y centraliza:
 *  - el flag global --json (fuerza salida máquina, patrón #3),
 *  - el manejo de errores -> exit codes estructurados (patrón #6).
 *
 * Se ejecuta sin build con:  npx tsx src/index.ts <args>
 * O instalado:               shopctl <args>
 */

import { Command } from 'commander';
import { forceJson, emitError } from './output.js';
import { registerProductCommands } from './commands/products.js';
import { registerCategoryCommands } from './commands/categories.js';
import { NetworkError, ApiError, BASE_URL } from './client.js';
import { CliError } from './errors.js';
import { InputError } from './input.js';
import { EXIT } from './exit.js';

const program = new Command();

program
  .name('shopctl')
  .description(
    `CLI agent-native sobre la API de DummyJSON (catálogo de productos).

Salida: tabla legible en terminal, JSON al pipear (o con --json).
Datos -> stdout · mensajes/errores -> stderr.
Config: SHOPCTL_BASE_URL (actual: ${BASE_URL}).`,
  )
  .version('0.1.0')
  .option('--json', 'Fuerza salida JSON aunque sea una terminal interactiva')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().json) forceJson();
  });

registerProductCommands(program);
registerCategoryCommands(program);

// Manejo de errores centralizado: NUNCA dejamos escapar un stacktrace crudo.
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  // --help y --version "lanzan" en commander con exitOverride: salir limpio.
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code: string }).code;
    if (c === 'commander.helpDisplayed' || c === 'commander.version' || c === 'commander.help') {
      process.exit(EXIT.OK);
    }
    // Errores de uso de commander (flag desconocido, arg faltante) -> code 2.
    if (typeof c === 'string' && c.startsWith('commander.')) {
      process.exit(EXIT.USAGE);
    }
  }

  // Mapeo de nuestros tipos de error a su exit code semántico (patrón #6).
  if (err instanceof CliError) {
    emitError({ error: err.message, code: err.code, hint: err.hint, statusCode: err.statusCode });
    process.exit(err.exitCode);
  }
  if (err instanceof InputError) {
    emitError({ error: err.message, code: err.code, hint: err.hint });
    process.exit(err.exitCode);
  }
  if (err instanceof NetworkError) {
    emitError({
      error: err.message,
      code: err.code,
      hint: 'Comprueba tu conexión o SHOPCTL_BASE_URL. Reintentar suele funcionar.',
    });
    process.exit(err.exitCode);
  }
  if (err instanceof ApiError) {
    emitError({
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
      hint: err.statusCode === 404 ? 'El recurso no existe. Revisa el id.' : undefined,
    });
    process.exit(err.exitCode);
  }

  // Cualquier otra cosa: error genérico.
  const message = err instanceof Error ? err.message : String(err);
  emitError({ error: message, code: 'UNEXPECTED_ERROR' });
  process.exit(EXIT.ERROR);
}
