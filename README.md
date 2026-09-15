# Plataforma MCP personal en Cloudflare

Worker remoto para conectar servicios propios con ChatGPT web. La primera integración es Google Calendar y vive en una ruta estable:

```text
https://TU-WORKER.workers.dev/mcp/google-calendar
```

La base está preparada para incorporar más servidores como rutas hermanas (`/mcp/notion`, `/mcp/home-assistant`, etc.) sin mezclar herramientas, scopes ni credenciales.

## Google Calendar

Expone seis herramientas: `list_calendars`, `list_events`, `get_event`, `create_event`, `update_event` y `delete_event`. Admite calendarios secundarios por ID o por nombre exacto —incluido **Familiar**—, ETags para evitar sobrescrituras y detección de duplicados exactos.

Evento de todo el día (el final siempre es exclusivo):

```json
{
  "calendar": { "name": "Familiar" },
  "summary": "Fiesta de fin de curso",
  "start": { "date": "2027-06-21" },
  "end": { "date": "2027-06-22" }
}
```

Evento con hora:

```json
{
  "calendar": { "id": "family-calendar-id" },
  "summary": "Tutoría",
  "start": { "dateTime": "2027-02-16T17:00:00+01:00", "timeZone": "Europe/Madrid" },
  "end": { "dateTime": "2027-02-16T17:30:00+01:00", "timeZone": "Europe/Madrid" }
}
```

## Desarrollo local

Requisitos: Node.js 22 y Wrangler.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Comprobaciones sin credenciales reales:

```bash
npm run typecheck
npm test
npm run build
```

`npm run build` genera un paquete Worker mediante un despliegue en seco; no publica nada.

## Estructura extensible

```text
src/worker.ts                         composición y rutas protegidas
src/platform/                         OAuth, D1, cifrado y registro de MCPs
src/mcps/google-calendar/             dominio, herramientas y adaptador Google
migrations/                           esquema compartido de D1
tests/                                pruebas de dominio, herramientas y HTTP
docs/                                 arquitectura, despliegue y planes
```

Para añadir otro MCP, crea `src/mcps/<slug>/`, registra su ruta y scopes en `src/platform/mcp-registry.ts`, crea su handler en `src/worker.ts` y añade la documentación y pruebas correspondientes. El slug publicado se considera estable.

Consulta [Arquitectura](docs/ARCHITECTURE.md) y [Despliegue](docs/DEPLOYMENT.md) para el detalle completo.
