/**
 * commands/categories.ts — Grupo noun-verb `shopctl categories …`.
 *
 * `list` expone el "enum" del dominio. Sirve a dos públicos:
 *  - humanos: para saber qué categorías existen.
 *  - agentes: como fuente de verdad para construir un --category válido
 *    (y es lo que la validación cachea internamente, patrón #5).
 */

import { Command } from 'commander';
import { getCategories } from '../client.js';
import { emit } from '../output.js';

export function registerCategoryCommands(program: Command): void {
  const categories = program
    .command('categories')
    .description('Categorías disponibles del catálogo.');

  categories
    .command('list')
    .alias('ls')
    .description('Lista todas las categorías válidas.')
    .action(async () => {
      const cats = await getCategories();
      // En JSON: array de strings. En humano: lista con viñetas (render genérico).
      emit(cats);
    });
}
