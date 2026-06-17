---
name: shopctl
description: Maneja el catálogo de productos (DummyJSON) desde la terminal con la CLI shopctl. Úsala cuando necesites listar, buscar, consultar, crear o borrar productos, o validar categorías. Devuelve JSON al pipear y respeta exit codes, así que es segura de encadenar.
---

# shopctl — gestión del catálogo de productos

`shopctl` es una CLI agent-native sobre la API de DummyJSON. Está pensada para que la uses TÚ (un copiloto/agente): pide JSON cuando lo necesites, lee los exit codes y aprovecha la validación local en vez de adivinar.

## Reglas de oro (léelas antes de actuar)

1. **Pide JSON con `--json`** cuando vayas a parsear la salida. Sin `--json` y pipeado ya sale JSON, pero ponerlo es explícito y a prueba de fallos.
2. **Los datos van a stdout; los mensajes y errores a stderr.** Captura stdout para el resultado y stderr para diagnosticar.
3. **Mira el exit code, no el texto:**
   - `0` ok · `1` error (p.ej. id inexistente) · `2` input inválido (corrige y reintenta, NO gastes otra llamada a ciegas) · `5` red (reintenta).
4. **No inventes categorías.** Valídalas con `shopctl categories list` o deja que `create` te corrija: si fallas, te dice "¿quisiste decir X?".
5. **Pide sólo los campos que necesitas** con `--fields` para no malgastar tokens.

## Workflows

### Explorar el catálogo
```bash
shopctl products list --limit 20 --json
shopctl products list --fields id,title,price --json     # sólo lo justo
shopctl products list --limit 20 --skip 20 --json        # siguiente página
```
Paginación: la respuesta trae `total`, `skip`, `limit`. Para recorrer todo, incrementa `--skip` en pasos de `--limit` hasta que `skip + limit >= total`.

### Encontrar un producto concreto
```bash
shopctl products search "phone" --fields id,title,price --json
shopctl products get 1 --json                            # detalle completo
shopctl products get 1 --fields title,price --json       # detalle reducido
```
Flujo típico: `search` para obtener el `id` → `get <id>` para el detalle.

### Crear un producto (con validación previa)
Antes de crear, asegúrate de la categoría:
```bash
shopctl categories list --json                           # enum válido
```
Crear con flags:
```bash
shopctl products create --title "Wireless Mouse" --price 29.99 --category electronics --json
```
Si la categoría no existe, NO se llama a la API: obtienes exit `2` y un hint con la categoría más parecida. Lee el hint, corrige y reintenta:
```bash
# Falla -> hint: "¿Quisiste decir 'mobile-accessories'?"  (exit 2)
# Reintenta con la categoría sugerida.
```
Crear desde un objeto que ya tienes construido (preferido para payloads grandes):
```bash
echo '{"title":"Wireless Mouse","price":29.99,"category":"mobile-accessories"}' \
  | shopctl products create --from-json - --json
```

### Borrar
```bash
shopctl products delete 5 --json        # o: shopctl products rm 5 --json
```

## Patrón de manejo de errores (cómo reaccionar)

| Lo que ves | Qué significa | Qué hacer |
|------------|---------------|-----------|
| exit `2`, code `VALIDATION_ERROR`, hay `hint` | tu input está mal | aplica el `hint` (suele traer la corrección exacta) y reintenta |
| exit `2`, code `INPUT_ERROR` | JSON mal formado / stdin vacío | revisa el fichero o el pipe |
| exit `1`, code `API_ERROR`, status `404` | el id no existe | re-busca con `search` |
| exit `5`, code `NETWORK_ERROR` | fallo de red | reintenta (backoff); revisa `SHOPCTL_BASE_URL` |

## Notas

- Base URL configurable con `SHOPCTL_BASE_URL` (default `https://dummyjson.com`).
- Los writes de DummyJSON son simulados: devuelven un objeto con `id` realista pero no persisten. Para la demo es suficiente.
- `--help` (largo) trae ejemplos por comando; `-h` es la versión corta.
