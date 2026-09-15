# Arquitectura

## Decisiones principales

El servidor usa una arquitectura hexagonal pequeña. El dominio valida eventos y calcula huellas de duplicado sin depender de Google ni de MCP. `CalendarService` resuelve calendarios y coordina los casos de uso contra el puerto `CalendarGateway`. Google Calendar y MCP son adaptadores reemplazables.

```text
ChatGPT web
  │ OAuth 2.1 + MCP Streamable HTTP
  ▼
Express ── OAuth bridge ── SQLite (tokens Google cifrados)
  │
  ▼
MCP tools ── CalendarService ── CalendarGateway ── Google Calendar API
                 │
                 └── validación, Europe/Madrid y duplicados
```

## Dos dominios OAuth separados

1. ChatGPT descubre `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server`, registra un cliente público mediante DCR y usa Authorization Code + PKCE S256.
2. `/oauth/authorize` redirige a Google. El servidor solicita acceso offline y guarda las credenciales Google cifradas con AES-256-GCM.
3. El callback emite un código MCP de un solo uso. `/oauth/token` entrega un JWT de 15 minutos y un refresh token opaco, también de un solo uso por rotación.
4. Cada llamada a `/mcp` valida audiencia, emisor, caducidad y scopes del JWT antes de cargar la cuenta Google asociada.

ChatGPT nunca recibe el token de Google y Google nunca recibe el token MCP.

## Scopes mínimos

- `openid email`: identidad estable y aplicación de `ALLOWED_GOOGLE_EMAILS`.
- `https://www.googleapis.com/auth/calendar.events`: leer y modificar eventos, sin permisos para cambiar calendarios, ACL o suscripciones.
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`: listar IDs y nombres, necesario para calendarios secundarios como **Familiar**.

Google recomienda elegir el scope más limitado posible y define precisamente esos permisos en su [documentación de scopes de Calendar](https://developers.google.com/workspace/calendar/api/auth).

## Fechas y zona horaria

- Todo el día: solo `{ "date": "YYYY-MM-DD" }`. `end.date` es exclusivo: un evento del 21 de junio usa fin `2027-06-22`.
- Con hora: solo `{ "dateTime": "...+01:00|+02:00", "timeZone": "Europe/Madrid" }`.
- El offset debe coincidir con `Europe/Madrid` en ese instante, por lo que se validan los cambios CET/CEST.
- No se admite mezclar `date` y `dateTime`, ni actualizar solo uno de los límites.

## Calendarios secundarios

Las herramientas aceptan `calendar.id` o `calendar.name`. El ID es preferente e inmutable. El nombre se compara de manera exacta ignorando mayúsculas; si dos calendarios tienen el mismo nombre, la operación se detiene y pide el ID. Sin selector se usa `primary`.

## Duplicados y concurrencia

Antes de crear, se consultan eventos solapados y se compara SHA-256 de título, inicio, fin y ubicación normalizados. Una coincidencia se rechaza salvo `duplicatePolicy: "allow"`. Las lecturas devuelven el ETag de Google; update/delete aceptan `etag` y convierten un `412 Precondition Failed` en un conflicto legible.

## Límites operativos

SQLite y el transporte sin estado hacen adecuada una sola instancia con volumen persistente. No se deben levantar varias réplicas contra el mismo archivo. Para alta disponibilidad, sustituir `Store` por PostgreSQL/Redis con consumo transaccional de códigos y refresh tokens.

