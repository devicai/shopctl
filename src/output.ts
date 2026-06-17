/**
 * output.ts — Presentación de datos: humano vs máquina.
 *
 * Patrón "agent-native" #3: Human format por defecto, JSON cuando se pipea.
 *
 * Reglas de oro que aplica este módulo:
 *  - Los DATOS van a stdout. Los MENSAJES/errores/hints van a stderr.
 *    (así un agente puede hacer `shopctl products list --json > data.json`
 *     sin que se le cuele un "Cargando..." dentro del fichero.)
 *  - El formato por defecto se DEDUCE del entorno: si stdout es un TTY
 *    (una persona mirando la terminal) -> tabla legible. Si está pipeado
 *    o redirigido (un script/agente consumiéndolo) -> JSON.
 *  - `--json` fuerza JSON aunque sea TTY. Nunca hay un flag que fuerce
 *    "human" cuando se pipea: no tendría sentido.
 */

export type OutputFormat = 'human' | 'json';

let forcedFormat: OutputFormat | undefined;

/** Llamado desde el flag global --json para forzar salida máquina. */
export function forceJson(): void {
  forcedFormat = 'json';
}

/**
 * Decide el formato efectivo.
 * Precedencia: --json (forzado) > detección de TTY.
 */
export function getFormat(): OutputFormat {
  if (forcedFormat) return forcedFormat;
  return process.stdout.isTTY ? 'human' : 'json';
}

// ── Salida de DATOS (siempre stdout) ─────────────────────────────────────────

/**
 * Emite `data` en el formato activo.
 * @param humanFn  renderiza la versión legible para personas (tabla/markdown).
 *                 Si no se pasa, se usa un render genérico.
 */
export function emit(data: unknown, humanFn?: (d: any) => string): void {
  if (getFormat() === 'json') {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write((humanFn ? humanFn(data) : genericHuman(data)) + '\n');
  }
}

// ── Salida de MENSAJES (siempre stderr) ──────────────────────────────────────

/** Nota informativa para humanos. En modo JSON se silencia (no contamina el pipe). */
export function note(text: string): void {
  if (getFormat() === 'human') process.stderr.write(`> ${text}\n`);
}

/**
 * Error estructurado con hint accionable.
 * En humano: texto legible a stderr. En JSON: objeto a stderr (parseable por un agente).
 * NO hace exit — el caller decide el exit code (separación de responsabilidades).
 */
export function emitError(err: { error: string; code: string; hint?: string; statusCode?: number }): void {
  if (getFormat() === 'human') {
    process.stderr.write(`\nError: ${err.error}\n`);
    process.stderr.write(`Code:  ${err.code}\n`);
    if (err.statusCode) process.stderr.write(`HTTP:  ${err.statusCode}\n`);
    if (err.hint) process.stderr.write(`\nHint:  ${err.hint}\n`);
  } else {
    process.stderr.write(JSON.stringify(err) + '\n');
  }
}

// ── Render humano: tabla alineada simple ─────────────────────────────────────

function genericHuman(data: unknown): string {
  if (data == null) return '(vacío)';
  if (Array.isArray(data)) return renderTable(data as Record<string, unknown>[]);
  if (typeof data === 'object') return renderProps(data as Record<string, unknown>);
  return String(data);
}

/** Tabla ASCII alineada por columnas a partir de un array de objetos planos. */
export function renderTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '(sin resultados)';
  if (typeof rows[0] !== 'object' || rows[0] === null) {
    // array de escalares (p.ej. lista de categorías) -> lista con viñetas
    return rows.map((r) => `- ${String(r)}`).join('\n');
  }
  const cols = Object.keys(rows[0]);
  const cells = rows.map((row) => cols.map((c) => cellText(row[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));

  const header = '  ' + cols.map((c, i) => c.toUpperCase().padEnd(widths[i])).join('   ');
  const sep = '  ' + widths.map((w) => '-'.repeat(w)).join('   ');
  const body = cells.map((r) => '  ' + r.map((v, i) => v.padEnd(widths[i])).join('   '));
  return [header, sep, ...body].join('\n');
}

/** Render clave-valor para un objeto único (detalle). */
export function renderProps(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const w = Math.max(...keys.map((k) => k.length));
  return keys.map((k) => `  ${k.padEnd(w)}  ${cellText(obj[k])}`).join('\n');
}

function cellText(v: unknown): string {
  if (v == null) return '-';
  if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
  return String(v);
}
