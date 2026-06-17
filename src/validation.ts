/**
 * validation.ts — EL FICHERO ESTRELLA de la charla.
 *
 * Patrón "agent-native" #5: la lógica de negocio vive EN LA CLI, no en la API.
 *
 * Idea central:
 *   En vez de mandar a la API un producto con `category:"smartfones"` (typo) y
 *   recibir un 400 genérico o, peor, un 200 que la acepta silenciosamente, la
 *   CLI VALIDA el input ANTES de llamar a la red y, si está mal, devuelve un
 *   error con HINT ACCIONABLE y un "did you mean?" calculado por similitud.
 *
 * Por qué importa para un AGENTE:
 *   - El agente recibe un mensaje que le dice EXACTAMENTE cómo arreglarlo
 *     ("¿quisiste decir 'smartphones'?"), no un stacktrace.
 *   - Sale con exit code 2 (VALIDATION) -> el agente sabe que es culpa del input
 *     y debe corregir y reintentar, sin gastar otra llamada de red.
 *   - El "enum" de categorías se valida contra la lista cacheada localmente
 *     (client.getCategories), no hardcodeada: si DummyJSON añade categorías,
 *     la validación se actualiza sola.
 *
 * Este es el corazón del discurso: "una CLI agent-native no es un curl con
 * azúcar; contiene conocimiento del dominio que ahorra round-trips y tokens".
 */

import { getCategories } from './client.js';

/** Un problema de validación: qué campo, qué pasa, y CÓMO arreglarlo. */
export interface Issue {
  field: string;
  message: string;
  /** Sugerencia accionable. Lo más valioso para un humano y para un agente. */
  hint: string;
}

/**
 * Distancia de Levenshtein (edit distance) entre dos strings.
 *
 * Es el algoritmo clásico de "did you mean?": cuántas inserciones, borrados o
 * sustituciones de un carácter hacen falta para convertir `a` en `b`.
 * Implementación iterativa con una sola fila (O(n) memoria) — suficiente y
 * sin dependencias, que es justo el espíritu de una CLI ligera.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // inserción
        prev[j] + 1, // borrado
        prev[j - 1] + cost, // sustitución
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Dado un valor inválido y una lista de candidatos, devuelve el más cercano
 * SI está "suficientemente cerca" (umbral relativo a la longitud, para no
 * sugerir disparates ante un input completamente distinto).
 */
function didYouMean(value: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(value.toLowerCase(), c.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  // Acepta la sugerencia sólo si el "coste" es ≤ ~40% de la palabra objetivo.
  const threshold = Math.max(2, Math.ceil((best?.length ?? 0) * 0.4));
  return best && bestDist <= threshold ? best : undefined;
}

/**
 * Valida una categoría contra la lista real (cacheada) de DummyJSON.
 * Devuelve un Issue (con "did you mean?") o undefined si es válida.
 */
export async function validateCategory(category: string | undefined): Promise<Issue | undefined> {
  if (category === undefined) return undefined; // categoría es opcional

  const categories = await getCategories();
  if (categories.includes(category)) return undefined; // ✅ válida

  const guess = didYouMean(category, categories);
  return {
    field: 'category',
    message: `'${category}' no es una categoría válida.`,
    hint: guess
      ? `¿Quisiste decir '${guess}'? Lista completa: shopctl categories list`
      : `Categorías válidas: ejecuta 'shopctl categories list' para verlas.`,
  };
}

/**
 * Valida el precio: debe ser un número finito y estrictamente > 0.
 * Acepta string (lo que llega de un flag) o number (lo que llega de un JSON).
 */
export function validatePrice(price: unknown): Issue | undefined {
  if (price === undefined || price === null) {
    return {
      field: 'price',
      message: 'Falta el precio.',
      hint: 'Pasa --price <numero> o incluye "price" en el JSON. Ej: --price 19.99',
    };
  }
  const n = typeof price === 'string' ? Number(price) : price;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    return {
      field: 'price',
      message: `Precio inválido: '${price}'.`,
      hint: 'El precio debe ser un número mayor que 0. Ej: --price 19.99',
    };
  }
  return undefined;
}

/** Valida el título: no vacío. */
export function validateTitle(title: unknown): Issue | undefined {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return {
      field: 'title',
      message: 'Falta el título o está vacío.',
      hint: 'Pasa --title "<texto>" o incluye "title" en el JSON.',
    };
  }
  return undefined;
}

/**
 * Valida el payload completo de creación de producto.
 * Devuelve TODOS los issues encontrados (no se para en el primero): un agente
 * prefiere ver de golpe todo lo que tiene que arreglar.
 */
export async function validateProductInput(input: {
  title?: unknown;
  price?: unknown;
  category?: unknown;
}): Promise<Issue[]> {
  const issues: Issue[] = [];

  const titleIssue = validateTitle(input.title);
  if (titleIssue) issues.push(titleIssue);

  const priceIssue = validatePrice(input.price);
  if (priceIssue) issues.push(priceIssue);

  // category es opcional; sólo se valida si viene
  if (input.category !== undefined) {
    const catIssue = await validateCategory(String(input.category));
    if (catIssue) issues.push(catIssue);
  }

  return issues;
}
