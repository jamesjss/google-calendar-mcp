# Despliegue en Cloudflare Workers

Para uso personal de bajo volumen, esta implementación está diseñada para caber en los límites gratuitos de Workers, KV y D1. Cloudflare puede cambiar cuotas y precios; revísalos antes de un uso intensivo. No se usan Containers, porque requieren Workers Paid.

## 1. Preparar Google Cloud

1. Crea o elige un proyecto y habilita **Google Calendar API**.
2. Configura la pantalla de consentimiento OAuth. En uso personal puede estar en modo Testing, con tu correo como test user.
3. Añade los cuatro scopes de Google descritos en [Arquitectura](./ARCHITECTURE.md#permisos-mínimos).
4. Crea un OAuth client de tipo **Web application**.
5. Cuando conozcas la URL final del Worker, añade exactamente:

   `https://TU-WORKER.TU-SUBDOMINIO.workers.dev/oauth/google/callback`

El callback no contiene el slug; la autorización temporal cifrada determina qué MCP inició el flujo.

## 2. Crear los recursos Cloudflare

Inicia sesión y crea un KV y una base D1:

```bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler d1 create personal-mcp-platform
```

Sustituye en `wrangler.jsonc` los dos IDs de ceros por los IDs devueltos. El nombre del Worker, `personal-mcp-platform`, puede cambiarse antes del primer despliegue; las rutas MCP no deben cambiar.

Aplica el esquema remoto:

```bash
npm run db:migrate:remote
```

## 3. Cargar secretos

Genera una clave y guárdala de forma segura:

```bash
openssl rand -base64 32
```

Carga valores sin escribirlos en Git:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
```

Configura tu correo en `ALLOWED_GOOGLE_EMAILS` dentro de `wrangler.jsonc`; admite varios separados por coma. Para uso personal no lo dejes vacío.

No cambies `TOKEN_ENCRYPTION_KEY` después de conectar Google: los tokens existentes dejarían de poder descifrarse. Una rotación requiere descifrar y volver a cifrar los registros.

## 4. Publicar y comprobar

```bash
npm run typecheck
npm test
npm run build
npm run deploy
```

Comprueba:

```text
https://TU-WORKER.../healthz
https://TU-WORKER.../.well-known/oauth-protected-resource/mcp/google-calendar
```

La segunda URL debe anunciar como `resource` la URL exacta terminada en `/mcp/google-calendar`.

## 5. Conectar ChatGPT web

1. Activa el modo desarrollador de Apps/Conectores en ChatGPT.
2. Crea una app personalizada con esta URL MCP:

   `https://TU-WORKER.../mcp/google-calendar`

3. Selecciona OAuth. ChatGPT descubrirá automáticamente los endpoints y pedirá conectar Google.
4. Acepta la pantalla de consentimiento local y autoriza exactamente la cuenta permitida.
5. Analiza las herramientas. Deben aparecer seis; prueba primero `list_calendars` y después una lectura de **Familiar**.
6. Haz la primera escritura en un calendario de pruebas.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Google necesita un callback accesible desde el navegador. Para una prueba OAuth local, autoriza `http://localhost:8787/oauth/google/callback` en un cliente Google separado de desarrollo. ChatGPT web requiere el Worker público.

## Operación y recuperación

- Consulta logs con `npm run logs`; no registres cabeceras Authorization, códigos ni cuerpos OAuth.
- Para desconectar, elimina la app en ChatGPT y revoca el acceso en la cuenta Google.
- Si se filtra un secreto, rota `GOOGLE_CLIENT_SECRET`, revoca las conexiones Google y vuelve a autorizar.
- KV contiene las sesiones MCP y D1 los tokens Google cifrados. Exporta D1 si necesitas una copia; conserva aparte la clave de cifrado.
- Tras cambiar herramientas o scopes, usa de nuevo **Actualizar/Analizar herramientas** en ChatGPT.

## Dominio personalizado

Puedes añadirlo más adelante sin cambiar el código. Mantén `/mcp/google-calendar`, añade el nuevo callback en Google y crea/reconecta la app de ChatGPT con la nueva URL. Conserva temporalmente el dominio anterior hasta completar la transición.
