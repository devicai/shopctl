/**
 * commands/products.ts — Grupo noun-verb `shopctl products …` (patrón #1).
 *
 * Verbos: list (alias ls) · get · search · create · delete (alias rm).
 * Aplica progressive disclosure (--fields, patrón #2), output dual (patrón #3),
 * inputs por fichero/stdin (#4) y validación con hints (#5).
 */

import { Command } from 'commander';
import { request } from '../client.js';
import { emit, note, renderTable, renderProps } from '../output.js';
import { readJsonInput } from '../input.js';
import { validateProductInput } from '../validation.js';
import { fail } from '../errors.js';
import { EXIT } from '../exit.js';

/** Campos por defecto en `list` y `search`: set reducido, NO el objeto completo. */
const DEFAULT_FIELDS = 'id,title,price,category';

interface Product {
  id: number;
  title?: string;
  price?: number;
  category?: string;
  [k: string]: unknown;
}

interface ProductList {
  products: Product[];
  total: number;
  skip: number;
  limit: number;
}

/** Convierte "title,price" -> "title,price" para el query `select=` de DummyJSON. */
function fieldsToSelect(fields: string | undefined): string | undefined {
  if (!fields) return undefined;
  // `select` siempre necesita `id` para que cada fila sea identificable.
  const set = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));
  set.add('id');
  return [...set].join(',');
}

export function registerProductCommands(program: Command): void {
  const products = program
    .command('products')
    .description('Gestiona productos del catálogo (DummyJSON).');

  // ── list / ls ──────────────────────────────────────────────────────────────
  products
    .command('list')
    .alias('ls') // alias UNIX visible (patrón #1)
    .description('Lista productos con paginación.')
    .option('--limit <n>', 'Número de productos a devolver', '10')
    .option('--skip <n>', 'Número de productos a saltar (paginación)', '0')
    .option('--fields <csv>', 'Devuelve sólo estos campos (eficiencia de tokens)', DEFAULT_FIELDS)
    .addHelpText(
      'after',
      `
Ejemplos:
  $ shopctl products list --limit 5
  $ shopctl products list --fields title,price          # progressive disclosure
  $ shopctl products list --json | jq '.products[].title'
  $ shopctl products ls --limit 20 --skip 20            # página 2

Por defecto devuelve un set reducido de campos (${DEFAULT_FIELDS}), no el objeto
completo: un agente paga tokens por cada campo que no necesita.`,
    )
    .action(async (opts: { limit: string; skip: string; fields: string }) => {
      const data = await request<ProductList>('/products', {
        query: { limit: opts.limit, skip: opts.skip, select: fieldsToSelect(opts.fields) },
      });
      note(`Mostrando ${data.products.length} de ${data.total} productos (skip=${data.skip}).`);
      emit(data, (d: ProductList) => renderTable(d.products as Record<string, unknown>[]));
    });

  // ── get ─────────────────────────────────────────────────────────────────────
  products
    .command('get <id>')
    .description('Obtiene el detalle de un producto por id.')
    .option('--fields <csv>', 'Devuelve sólo estos campos')
    .action(async (id: string, opts: { fields?: string }) => {
      const data = await request<Product>(`/products/${encodeURIComponent(id)}`, {
        query: { select: fieldsToSelect(opts.fields) },
      });
      emit(data, (d: Product) => renderProps(d as Record<string, unknown>));
    });

  // ── search <q> ────────────────────────────────────────────────────────────────
  products
    .command('search <query>')
    .description('Busca productos por texto.')
    .option('--limit <n>', 'Máximo de resultados', '10')
    .option('--fields <csv>', 'Devuelve sólo estos campos', DEFAULT_FIELDS)
    .addHelpText(
      'after',
      `
Ejemplos:
  $ shopctl products search phone
  $ shopctl products search laptop --fields title,price --limit 5`,
    )
    .action(async (query: string, opts: { limit: string; fields: string }) => {
      const data = await request<ProductList>('/products/search', {
        query: { q: query, limit: opts.limit, select: fieldsToSelect(opts.fields) },
      });
      note(`${data.total} coincidencia(s) para "${query}".`);
      emit(data, (d: ProductList) => renderTable(d.products as Record<string, unknown>[]));
    });

  // ── create ────────────────────────────────────────────────────────────────────
  products
    .command('create')
    .description('Crea un producto. Valida el input ANTES de llamar a la API.')
    .option('--title <text>', 'Título del producto')
    .option('--price <n>', 'Precio (número > 0)')
    .option('--category <name>', 'Categoría (validada contra categories list)')
    .option('--from-json <path>', 'Lee el payload de un fichero JSON (o - para stdin)')
    .addHelpText(
      'after',
      `
Ejemplos:
  $ shopctl products create --title "Cosa" --price 19.99 --category smartphones
  $ shopctl products create --from-json product.json
  $ cat product.json | shopctl products create --from-json -

Validación local (patrón estrella): si la categoría no existe te sugiere la más
parecida ("did you mean?") y sale con code 2 SIN tocar la API.`,
    )
    .action(
      async (opts: {
        title?: string;
        price?: string;
        category?: string;
        fromJson?: string;
      }) => {
        // 1) Construye el payload: --from-json es la base, los flags lo sobreescriben.
        let payload: Record<string, unknown> = {};
        if (opts.fromJson) payload = readJsonInput(opts.fromJson);
        if (opts.title !== undefined) payload.title = opts.title;
        if (opts.price !== undefined) payload.price = Number(opts.price);
        if (opts.category !== undefined) payload.category = opts.category;

        // 2) VALIDA en local (patrón #5). Si hay issues, ni rozamos la red.
        const issues = await validateProductInput(payload);
        if (issues.length > 0) {
          const first = issues[0];
          // Loguea TODOS los issues a stderr para que el agente los vea de golpe.
          for (const i of issues) note(`[${i.field}] ${i.message} ${i.hint}`);
          fail({
            error: `Input inválido: ${issues.map((i) => i.field).join(', ')}`,
            code: 'VALIDATION_ERROR',
            hint: first.hint,
            exitCode: EXIT.USAGE,
          });
        }

        // 3) Sólo ahora llamamos a la API.
        const created = await request<Product>('/products/add', {
          method: 'POST',
          body: payload,
        });
        note(`Producto creado con id ${created.id}.`);
        emit(created, (d: Product) => renderProps(d as Record<string, unknown>));
      },
    );

  // ── delete / rm ──────────────────────────────────────────────────────────────
  products
    .command('delete <id>')
    .alias('rm') // alias UNIX visible (patrón #1)
    .description('Elimina un producto por id.')
    .action(async (id: string) => {
      const data = await request<Product>(`/products/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      note(`Producto ${id} eliminado.`);
      emit(data, (d: Product) => renderProps(d as Record<string, unknown>));
    });
}
