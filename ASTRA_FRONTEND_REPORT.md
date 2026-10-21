# ASTRA — Reporte histórico de experiencia frontend

> Línea base anterior a Orbital. Las pruebas, scheduler y reportes en este archivo describen su fecha; consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](ASTRA_ORBITAL_RELEASE_REPORT.md) para el estado actual.

Fecha: 21 de octubre de 2026.

## Cambios realizados

- Se reemplazó la pantalla inicial de login por una landing pública con marca ASTRA, navegación, hero, vista previa ilustrativa, capacidades, pasos, plataforma, sección académica, CTA y footer.
- La vista previa usa valores estáticos con etiquetas visibles “Vista de demostración” y “Datos ilustrativos”; no llama a APIs ni consulta información tenant.
- Se creó marca geométrica propia en CSS y se utilizaron iconos Lucide. No se usan emojis como logotipo.
- Se añadieron rutas `/`, `/login`, `/register`, `/app` y `/app/{portfolios,projects,resources,budgets,priorities}` mediante historial del navegador, preservando las APIs.
- El login mantiene el `POST /auth/login` local y Cognito existente. Tiene validación HTML, control de visibilidad de contraseña, carga y error accesible.
- La sesión local continúa usando los mismos campos `cloudportfolio.*`; tenant y rol siguen proviniendo del token/backend. Logout elimina la sesión local o cierra Cognito.
- El panel interno mantiene las funcionalidades presentes, añade identidad ASTRA y conserva navegación por secciones.
- Se agregó `CORSMiddleware` limitado a `CORS_ORIGIN` (por defecto `http://localhost:5173`) en Resource, Budget y Priority. Era necesario para que el dashboard local pudiera acceder a las APIs Python desde Vite; sus solicitudes preflight respondían HTTP 405 antes de este cambio.
- README raíz y `frontend/README.md` actualizados.

## Causa y corrección UTF-8

`frontend/index.html` ya declaraba UTF-8. No se encontró una conversión global/doble codificación del navegador ni Vite. La causa era una mezcla de literales que ya contenían secuencias mojibake (acentos, comillas, flechas y glifo del logo) y caracteres correctamente codificados que PowerShell mostraba mal según su página de códigos.

Se corrigieron los literales identificables dentro de `frontend/src/main.tsx`, se retiró el glifo roto, se añadió `lang="es"`, metadatos y título ASTRA, y se mantuvo UTF-8 en los archivos. Las respuestas API son JSON y el frontend decodifica JSON con `response.json()`; no se transformaron datos de negocio.

Se añadió `tests/frontend-utf8.test.mjs`: decodificación UTF-8 estricta de HTML/TSX/CSS, comprobación de charset, textos de autenticación, rutas y ausencia de secuencias mojibake comunes.

## Rutas y componentes

Implementados en `frontend/src/main.tsx`:

- `Landing`: landing pública con navegación móvil y secciones solicitadas.
- `DashboardPreview`: visual estático separado de APIs, marcado como demostración.
- `Brand`: marca vectorial CSS reutilizable.
- `AuthPage`: login y aviso de registro pendiente.
- `Dashboard`: consola privada ya existente con navegación y consumos API.
- `App`/`usePathname`: resolución de rutas, sesión y protección de `/app/*`.

Los estilos están en `frontend/src/style.css`, con breakpoints para 1050/820/600 px, focus visible y `prefers-reduced-motion`.

## Registro y aprovisionamiento

El registro **no está implementado**. El Identity service local autentica cuentas demo y no aprovisiona de forma segura tenant, perfil y administrador. Cognito declara atributos custom y un User Pool, pero no hay flujo de aprovisionamiento de organización conectado a la aplicación. Por eso `/register` comunica que está deshabilitado y no presenta un formulario que simule éxito.

## Pruebas ejecutadas

- `npm test`: 18/18 aprobadas, incluyendo dos verificaciones nuevas de fuentes UTF-8 y rutas/textos.
- `py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q`: 18 aprobadas; incluye una prueba CORS por microservicio Python.
- `py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service tests`: aprobado.
- `npm run build --workspace frontend`: TypeScript y Vite aprobados; 2 186 módulos transformados.
- Navegación manual en Chrome: landing, login, ruta de registro, módulo protegido `/app/portfolios`, cierre de sesión y bloqueo de `/app/projects` sin sesión.
- Login demo incorrecto: API devuelve 401 y la interfaz muestra un mensaje en español. Login demo correcto: navega a `/app`.
- Dashboard privado: después de habilitar CORS, las APIs Node y Python devolvieron datos visibles. Preflight de Resource/Budget/Priority responde 200 desde el origen local.
- Inspección visual de escritorio: landing verificada en navegador a resolución de escritorio.

## No verificado y pendientes

- No se instaló Playwright ni se creó una suite E2E persistente; las verificaciones de navegador fueron manuales usando Chrome.
- La emulación exacta de tablet y móvil no estuvo disponible en el navegador de pruebas. Los breakpoints se implementaron, pero no se reporta verificación visual en esos tamaños.
- En la fase inicial no se guardó una captura de pantalla; la actualización Galaxy posterior sí deja evidencia en `docs/ASTRA_GALAXY_LANDING.png`.
- CORS productivo debe configurarse para el dominio Amplify mediante `CORS_ORIGIN`/API Gateway. El valor predeterminado implementado es únicamente el origen de desarrollo local.
- Registro seguro pendiente de diseño backend para tenant, verificación de correo, prevención de duplicados, administración inicial y aprovisionamiento Cognito/local.
- El dashboard mantiene algunas limitaciones funcionales preexistentes (paginación resumida, capacidades incompletas); no se presentaron como nuevas capacidades del rediseño.

## Archivos principales

- `frontend/index.html`
- `frontend/src/main.tsx`
- `frontend/src/style.css`
- `frontend/README.md`
- `services/resource-service/app.py`
- `services/budget-service/app.py`
- `services/priority-service/app.py`
- `services/resource-service/test_resource.py`
- `services/budget-service/test_budget.py`
- `services/priority-service/test_priority.py`
- `tests/frontend-utf8.test.mjs`
- `README.md`
- `ASTRA_IMPLEMENTATION_STATUS.md`

## Actualización ASTRA Galaxy (21 de octubre de 2026)

La interfaz recibió el sistema oscuro galáctico, un logotipo orbital CSS con favicon SVG, landing con secciones de Inteligencia/Notificaciones y el panel protegido correspondiente. La consola incorpora un asistente determinista conectado a APIs y un centro local de preferencias/buzón. No hay LLM ni envío real a WhatsApp. El estado actualizado, rutas API, pruebas, límites AWS y publicación Git se encuentran en [ASTRA_GALAXY_IMPLEMENTATION_REPORT.md](ASTRA_GALAXY_IMPLEMENTATION_REPORT.md).

Las pruebas Playwright actuales completaron 2/2 escenarios en Chromium: autenticación/rutas y layout móvil; inteligencia, preferences y verificación local; evento ProjectCreated al buzón; aislamiento tenant A/B, roles MANAGER/VIEWER y subida/descarga S3 local. Esto amplía la evidencia del bloque anterior, que indicaba que Playwright aún no estaba configurado. AWS, provider Business, scheduler y publicación siguen sin verificar/realizar.
