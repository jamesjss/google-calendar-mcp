# Google Calendar MCP para ChatGPT web

Servidor MCP remoto, pequeño y autoalojable, para gestionar Google Calendar desde ChatGPT web. Soporta calendarios secundarios como **Familiar**, eventos de todo el día correctos, eventos con hora en `Europe/Madrid`, prevención de duplicados y OAuth extremo a extremo.

## Funcionalidad

- `list_calendars`: lista IDs, nombres, permisos y zona horaria.
- `list_events`: busca eventos dentro de un rango.
- `get_event`: obtiene un evento y su ETag.
- `create_event`: crea eventos y rechaza duplicados exactos por defecto.
- `update_event`: modifica campos con control de concurrencia opcional por ETag.
- `delete_event`: borra un evento con control de concurrencia opcional.

Un día completo se expresa así:

```json
{
  "calendar": { "name": "Familiar" },
  "summary": "Fiesta de fin de curso",
  "start": { "date": "2027-06-21" },
  "end": { "date": "2027-06-22" }
}
```

Un evento con hora se expresa así:

```json
{
  "calendar": { "id": "family-calendar-id" },
  "summary": "Tutoría",
  "start": { "dateTime": "2027-02-16T17:00:00+01:00", "timeZone": "Europe/Madrid" },
  "end": { "dateTime": "2027-02-16T17:30:00+01:00", "timeZone": "Europe/Madrid" }
}
```

## Inicio rápido de desarrollo

Requisitos: Node.js 22 y un proyecto OAuth Web de Google.

```bash
cp .env.example .env
npm ci
npm test
npm run dev
```

Rellena `.env` antes de arrancar. Para instrucciones completas consulta [Despliegue](docs/DEPLOYMENT.md); el razonamiento de seguridad y diseño está en [Arquitectura](docs/ARCHITECTURE.md).

## Seguridad por defecto

- Google concede solo acceso a eventos y lectura de la lista de calendarios; no se solicitan permisos de ACL ni de administración de calendarios.
- Las credenciales Google se cifran con AES-256-GCM antes de entrar en SQLite.
- OAuth MCP usa PKCE S256, códigos de un solo uso, JWT breves y refresh tokens rotatorios.
- En producción se exige HTTPS y una lista de orígenes OAuth permitidos.
- El proceso escucha solo en localhost salvo que el despliegue configure `HOST=0.0.0.0` explícitamente.
- `ALLOWED_GOOGLE_EMAILS` permite limitar el servidor a una cuenta concreta.
- Las operaciones de Google usan `sendUpdates=none`; este proyecto no añade invitados ni envía notificaciones.

## Comprobaciones

```bash
npm run typecheck
npm test
npm run build
```

La suite no necesita credenciales reales: usa dobles de prueba para Google y transporte MCP en memoria. La validación manual final sí requiere desplegar, autorizar tu cuenta Google y crear un evento de prueba.

## Estructura

```text
src/domain          reglas de fechas, modelos y huellas de duplicado
src/application     casos de uso y puerto CalendarGateway
src/adapters        adaptador Google Calendar
src/auth            OAuth MCP ↔ Google y tokens de sesión
src/infrastructure  SQLite y cifrado
src/mcp             herramientas y transporte MCP HTTP
tests               pruebas unitarias y de integración
docs                arquitectura, despliegue y plan
```

Licencia pendiente de decisión del propietario; el proyecto se entrega como código privado por defecto.
