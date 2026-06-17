# shopctl

CLI **agent-native** sobre la API pública de [DummyJSON](https://dummyjson.com) (catálogo de productos).
Ejemplo didáctico de la charla **"De APIs a CLIs"**: cómo se diseña una CLI pensada para que la consuma un agente, no sólo una persona.

Mismo stack que la `devic-cli` real: **Node 20+ · TypeScript · commander**. Sin dependencias pesadas (sólo `commander` + `fetch` nativo).

## Ejecutar

Sin build, directo desde el código:

```bash
npx tsx src/index.ts products list --limit 3
```

O compilado / instalado:

```bash
npm install
npm run build           # tsc -> dist/
node dist/index.js products list
# o, con bin instalado:  shopctl products list
```

## Filosofía (lo que la hace "agent-native")

- **Estructura noun-verb.** `shopctl <recurso> <verbo>`: `products list`, `products get <id>`, `products create`, `categories list`. Alias UNIX visibles: `ls`→`list`, `rm`→`delete`.
- **Progressive disclosure.** `-h` da ayuda corta, `--help` añade ejemplos. En las respuestas, `--fields title,price` devuelve sólo esos campos (se mapea al `select=` de la API): menos tokens, menos ruido. Por defecto `list` ya devuelve un set reducido, no el objeto completo.
- **Human por defecto, JSON al pipear.** En terminal interactiva → tabla legible. Pipeado o redirigido (un agente/script) → JSON. `--json` lo fuerza. **Datos a stdout, mensajes/errores a stderr** (puedes `> data.json` sin que se cuele un "Cargando…").
- **Inputs por fichero/stdin.** `--from-json product.json` o `--from-json -` para stdin. No cuelga esperando si no hay nada pipeado.
- **Lógica de negocio en la CLI.** Valida `--category` contra el catálogo real y `--price` (> 0) **antes** de llamar a la API, con `did you mean?` accionable. Esto ahorra round-trips y le dice al agente exactamente cómo corregir.
- **Errores estructurados + exit codes.** `0` ok · `1` error · `2` input inválido · `5` red.

## Comandos

```bash
# Productos
shopctl products list [--limit 10] [--skip 0] [--fields id,title,price]
shopctl products ls --limit 20 --skip 20                 # alias + página 2
shopctl products get <id> [--fields title,price]
shopctl products search <query> [--limit 10] [--fields ...]
shopctl products create --title "X" --price 19.99 --category smartphones
shopctl products create --from-json product.json
cat product.json | shopctl products create --from-json -
shopctl products delete <id>
shopctl products rm <id>                                  # alias

# Categorías (el "enum" del dominio)
shopctl categories list
```

## Salida y exit codes

| Exit | Significado | Qué hace un agente |
|------|-------------|--------------------|
| `0` | OK | continúa |
| `1` | Error de operación (p.ej. 404) | revisa el recurso |
| `2` | Input inválido / usage | corrige el input y reintenta (sin gastar red) |
| `5` | Error de red | reintenta con backoff |

Errores siempre a **stderr** como JSON parseable: `{"error":"…","code":"…","hint":"…"}`.

## Configuración

| Variable | Default | Descripción |
|----------|---------|-------------|
| `SHOPCTL_BASE_URL` | `https://dummyjson.com` | Base URL de la API |

## Requisitos

- Node.js 20+ (usa `fetch` nativo).
