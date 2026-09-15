# Arquitectura

## Plataforma multi-MCP

El proyecto es un único Cloudflare Worker con varias rutas MCP protegidas. Cada integración ocupa `src/mcps/<slug>` y se publica en `/mcp/<slug>`. El registro central define la identidad pública de cada servidor:

```text
ChatGPT web
  │ MCP + OAuth 2.1
  ▼
Cloudflare Worker
  ├── /mcp/google-calendar ── CalendarService ── Google Calendar REST API
  ├── /mcp/<futuro>          ── herramientas propias ── API propia
  ├── Workers OAuth Provider ── KV (clientes, grants y tokens MCP)
  └── OAuth Google           ── D1 (credenciales Google cifradas)
```

El enrutado protegido se configura con `apiHandlers`: cada ruta recibe únicamente su servidor. Los tokens incluyen `mcpSlug` y los scopes de esa integración; el servidor vuelve a comprobarlos al ejecutar herramientas. De este modo, añadir un MCP no concede acceso implícito a los demás.

## Capas

- `platform`: infraestructura reutilizable (registro, OAuth, Web Crypto, KV/D1 y tipos del Worker).
- `mcps/google-calendar/domain`: fechas, modelos y huella normalizada de duplicados.
- `mcps/google-calendar/application`: casos de uso independientes de Google y MCP.
- `google-calendar-gateway`: adaptador HTTP a Calendar API v3, con renovación de tokens.
- `tools` y `server`: contrato MCP y composición por petición.

El servidor MCP es stateless: se crea por petición y puede ejecutarse en cualquier ubicación de Cloudflare. No hay proceso permanente ni contenedor.

## OAuth y almacenamiento

Hay dos relaciones separadas:

1. ChatGPT usa Authorization Code + PKCE contra el Workers OAuth Provider. El proveedor guarda en KV los clientes dinámicos, grants, access tokens y refresh tokens rotatorios.
2. El usuario ve una pantalla de consentimiento propia protegida con CSRF y después autoriza Google. El callback guarda los tokens Google cifrados con AES-256-GCM en D1.

ChatGPT nunca recibe credenciales Google. D1 solo guarda ciphertext; la clave vive como secreto `TOKEN_ENCRYPTION_KEY`. Los handoffs de autorización son cifrados, caducan a los diez minutos y se consumen una sola vez mediante `DELETE ... RETURNING`.

## Permisos mínimos

Scopes MCP:

- `google-calendar.read`
- `google-calendar.write`

Scopes Google:

- `openid email`, para identificar y limitar la cuenta.
- `calendar.events`, para leer y modificar eventos sin administrar calendarios o ACL.
- `calendar.calendarlist.readonly`, para localizar calendarios secundarios como **Familiar**.

`ALLOWED_GOOGLE_EMAILS` (secreto de Cloudflare, no variable pública) debe contener la cuenta autorizada en un despliegue personal.

## Fechas, duplicados y concurrencia

- Todo el día usa exclusivamente `start.date` y `end.date`; el final es exclusivo.
- Con hora usa `dateTime`, offset explícito y `Europe/Madrid`. Se valida CET/CEST para el instante concreto.
- No se permite mezclar `date` y `dateTime` ni actualizar un solo límite.
- Antes de crear se comparan título, inicio, fin y ubicación normalizados con los eventos del intervalo. Se puede aceptar un duplicado solo con `duplicatePolicy: "allow"`.
- Las lecturas conservan el ETag de Google; update/delete envían `If-Match` cuando se aporta.
- Todas las escrituras usan `sendUpdates=none`: no se añaden invitados ni se envían avisos.

## Añadir un MCP

1. Elige un slug estable, corto y sin datos de usuario.
2. Crea `src/mcps/<slug>/` con su servidor y adaptadores.
3. Añade ruta y scopes específicos a `MCP_REGISTRY`.
4. Añade un handler con la misma ruta a `apiHandlers` en `src/worker.ts`.
5. Haz que sus credenciales se identifiquen por proveedor/usuario y, si comparte tablas, por `mcp_slug`.
6. Añade pruebas de coincidencia exacta, aislamiento de scopes y herramientas.

Un dominio personalizado puede sustituir `workers.dev` sin alterar `/mcp/<slug>`; en ChatGPT se crea una nueva conexión para la nueva URL.
