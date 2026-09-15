# Despliegue

## 1. Preparar Google Cloud

1. Crea o elige un proyecto en Google Cloud Console.
2. Habilita **Google Calendar API**.
3. Configura la pantalla de consentimiento OAuth. Para uso personal, tipo `External` en modo de prueba y tu correo como usuario de prueba es suficiente.
4. Añade exactamente los cuatro scopes descritos en [Arquitectura](./ARCHITECTURE.md#scopes-mínimos).
5. Crea credenciales **OAuth client ID → Web application**.
6. Añade como URI de redirección autorizada `https://TU-DOMINIO/oauth/google/callback`.
7. Conserva el client ID y client secret. El servidor solicita `access_type=offline`, tal como indica la [guía OAuth de Google para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server#offline).

Mientras la aplicación Google esté en modo Testing, mantén tu cuenta en la lista de test users. Para un servicio público/multiusuario pueden aplicar verificación de Google y una política de privacidad.

## 2. Configurar secretos

Copia `.env.example` a `.env` y sustituye todos los valores. Genera claves independientes:

```bash
openssl rand -base64 32
openssl rand -base64 48
```

Usa la primera como `TOKEN_ENCRYPTION_KEY` y la segunda como `JWT_SECRET`. Para uso personal, configura `ALLOWED_GOOGLE_EMAILS` con tu correo. En producción, `ALLOWED_REDIRECT_ORIGINS` es obligatorio; empieza con los orígenes de ChatGPT del ejemplo y ajústalo si el registro del cliente devuelve un origen distinto y legítimo.

No cambies `TOKEN_ENCRYPTION_KEY` mientras existan conexiones: perderías la capacidad de descifrar los tokens Google. Guarda una copia segura de la clave y del archivo SQLite.

## 3. Ejecutar

Local con Node:

```bash
npm ci
npm run build
npm start
```

Contenedor local:

```bash
docker compose up --build
```

Comprueba `http://127.0.0.1:3000/healthz`. ChatGPT no conecta directamente a localhost: publica temporalmente el puerto mediante un túnel HTTPS de confianza, o despliega el contenedor. La documentación oficial de OpenAI también indica que ChatGPT requiere un [servidor MCP remoto o Secure MCP Tunnel](https://help.openai.com/es-419/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta).

## 4. Render

El `render.yaml` incluye un servicio Docker y un disco persistente de 1 GB.

1. Crea un Blueprint desde este repositorio.
2. Define `PUBLIC_BASE_URL` con la URL pública final, sin barra final.
3. Añade las credenciales Google y tu correo permitido.
4. Despliega una sola instancia.
5. Vuelve a Google Cloud y confirma que el callback coincide exactamente con la URL pública.

En cualquier plataforma equivalente, exige HTTPS, monta `/app/data` en almacenamiento persistente y no escales horizontalmente esta versión SQLite.
El proceso escucha solo en `127.0.0.1` por defecto; contenedores y proveedores deben establecer explícitamente `HOST=0.0.0.0`, como hacen los manifiestos incluidos.

## 5. Añadir a ChatGPT web

La interfaz puede variar durante la beta. Según la [documentación oficial de OpenAI sobre modo desarrollador](https://help.openai.com/es-419/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta):

1. Activa Developer Mode en la configuración de Apps de ChatGPT o del workspace.
2. Crea una app personalizada e introduce `https://TU-DOMINIO/mcp` como endpoint.
3. Elige OAuth. ChatGPT descubrirá el resto de endpoints automáticamente.
4. Pulsa analizar herramientas; inicia sesión con la cuenta Google permitida y acepta los scopes.
5. Verifica que aparecen seis herramientas y prueba primero `list_calendars` y `list_events`.
6. Prueba una escritura en un calendario de pruebas. ChatGPT puede solicitar confirmación para acciones de modificación.

El soporte completo de escritura está actualmente en beta para Business, Enterprise y Edu. Pro puede crear apps, pero su MCP personalizado está limitado actualmente a lectura/obtención. La selección de una app se aplica al mensaje; vuelve a mencionarla con `@` cuando un seguimiento necesite datos nuevos.

## 6. Operación y recuperación

- Copia regularmente `/app/data/calendar-mcp.sqlite` y su clave de cifrado a ubicaciones separadas.
- Para desconectar ChatGPT, revoca la app desde ChatGPT y elimina/revoca el acceso en tu [Cuenta de Google](https://myaccount.google.com/connections).
- Si sospechas una filtración, rota `GOOGLE_CLIENT_SECRET` y `JWT_SECRET`, revoca conexiones Google y vuelve a autorizar. Rotar la clave de cifrado requiere primero una migración de datos; no basta con sustituirla.
- No registres cuerpos OAuth ni cabeceras Authorization. Esta implementación solo registra mensajes de error sanitizados.
- Tras cambiar esquemas de herramientas, usa **Actualizar/Analizar herramientas** en ChatGPT. Las definiciones publicadas se conservan como una instantánea hasta que el administrador aprueba la actualización.
