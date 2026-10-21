# ASTRA Galaxy — Reporte histórico de implementación

> Informe de línea base del 21 de octubre de 2026, anterior a las acciones Orbital, scheduler y reportes CSV. Su estado Git y sus pendientes ya no son actuales. Consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](ASTRA_ORBITAL_RELEASE_REPORT.md) para el estado vigente.

Fecha: 21 de octubre de 2026. Alcance: identidad visual, inteligencia determinista local, preferencias/notificaciones simuladas, validación de Serverless/Amplify y pruebas. No se desplegó AWS ni se ejecutó ningún seed.

## 1. Resultado ejecutivo

ASTRA tiene una identidad galáctica oscura aplicada a landing y consola, marca orbital CSS/SVG, favicon, asistente determinista de solo lectura y centro local de preferencias/notificaciones. El asistente consulta Project, Portfolio, Budget, Resource y Priority mediante sus APIs con el JWT del usuario; no consulta tablas ajenas ni usa un LLM. El worker local procesa eventos del tenant con SNS/SQS y crea avisos idempotentes en Identity DynamoDB marcados como simulados.

La validación local ejecutó Node, pytest, Ruff, build Vite, Playwright con Chromium, carga/descarga S3 en LocalStack, flujo ProjectCreated a buzón y pruebas negativas A/B/roles. Las verificaciones E2E pasaron en instancias temporales (puertos 5174/4111/4113) sobre los emuladores existentes; algunos registros/documentos de prueba permanecen en las bases persistentes. No se limpiaron volúmenes. El proceso previo del stack que usa 5173/4101–4106 se dejó activo y no se reinició; reinicia ASTRA local con `npm run dev:local` para cargar los handlers y worker recién modificados en los puertos habituales.

La preparación AWS está incompleta: no hay consumer AWS para notificaciones, proveedor WhatsApp Business, verificación externa de números, scheduler, permisos/API URLs validados ni empaquetado Serverless. Se agregó configuración Amplify en la raíz, pero no se probó en el servicio Amplify.

GitHub no se publicó: el directorio no contiene `.git`. No fue posible comprobar remoto, rama, archivos staged/tracked ni crear commit. El remoto indicado por el usuario no se contactó. No hice `git init`, clone, commit ni push.

## 2. Identidad visual

- Paleta oscura azul noche/índigo/violeta/cian aplicada a landing, login, dashboard, tablas y paneles.
- Fondo estelar CSS de bajo costo, paneles con contraste, microinteracciones y órbitas discretas.
- Marca original con núcleo y anillos; animación CSS suave y estática con `prefers-reduced-motion`.
- Favicon vectorial propio en `frontend/public/favicon.svg`.
- Landing ampliada con inteligencia y notificaciones; las capacidades locales/pendientes están rotuladas explícitamente.
- Captura pública de escritorio: [ASTRA Galaxy landing](docs/ASTRA_GALAXY_LANDING.png). Playwright verificó layout móvil a 390 px sin desbordamiento horizontal; no se realizó revisión manual en tablet.

## 3. Inteligencia ASTRA

Se agregó `POST /intelligence/ask` al Project Service. Contrato y límites en [API_GALAXY_CONTRACTS.md](docs/API_GALAXY_CONTRACTS.md).

- Autenticación: claims verificados por el handler/API Gateway; se permite ADMIN, MANAGER y VIEWER porque la ruta es read-only.
- Multi-tenant: no se acepta tenant/user del body. El token se propaga a APIs GET y cada servicio deriva su tenant de esos claims. Tareas se consultan en la tabla propia Project con PK del tenant autenticado.
- Herramientas: lista fija de APIs GET de dominio, sin acceso DynamoDB ajeno, sin herramientas elegidas por el texto y sin ejecución de cambios.
- Límites: pregunta de hasta 500 caracteres; 20 consultas/minuto por usuario y por instancia; máximo 100 resultados por dominio/página. Los endpoints faltantes/dependencias con error se reportan como `unavailable`; no se reemplazan con mocks.
- Reglas calculan vencimientos de proyectos/tareas, consumo presupuestario ≥80 %, carga frente a capacidad, portafolios con proyectos vencidos y prioridad máxima entre resultados consultados.
- Respuesta declara `mode=deterministic-local-rules`, `readOnly`, hechos, sugerencias, alcance y datos relacionados. No es un chatbot generativo. La UI diferencia hechos de recomendaciones y no altera datos.

Límites: consultas parciales de hasta 100 filas, rate limit en memoria por instancia y sin agregación completa/paginación interna para cada dominio. El cómputo de sobreasignación se basa en la página consultada; las APIs actuales normalmente previenen sobreasignar. Debe paginarse y probarse con volúmenes reales antes de usarlo como KPI estratégico.

## 4. Notificaciones y WhatsApp

Identity persiste preferencias bajo la partición tenant y el usuario del JWT. Los endpoints nuevos permiten leer/guardar preferencias, consultar buzón, revocar/eliminar número y probar una verificación local.

- El modo `local-simulator` requiere consentimiento explícito y un número con formato E.164. Un código de desarrollo se muestra en el buzón de verificación autenticado; confirma solo la simulación local y **no demuestra control del número ni verificación en WhatsApp**.
- `NOTIFICATION_MODE` queda `disabled` por defecto en Serverless. Sin provider oficial, la verificación devuelve 503.
- El buzón muestra **“Simulado localmente — No enviado a WhatsApp”**. No hay envío real, automatización de WhatsApp Web ni acceso a un proveedor externo.
- `notification-worker.mjs` consume la cola Identity local, filtra por tenant, evento, zona/horario y frecuencia inmediata; usa `eventId` para evitar duplicados.
- Se guardan opciones daily/weekly, pero todavía no se ejecutan. El worker local solo entrega eventos inmediatos. No hay EventBridge Scheduler ni consumer Lambda desplegable.

Pendiente antes de producción: opt-in verificable mediante canal oficial, plantillas aprobadas, revocación comprobada con el proveedor, estados y reintentos del provider, rate/cost limits, DLQ/alarma y scheduler autorizado por AWS Academy.

## 5. Eventos y datos locales

Flujo ejecutado: Project API → SNS LocalStack → SQS Identity → `notification-worker.mjs` → Identity DynamoDB → GET del buzón. El evento ProjectCreated de la prueba generó un registro `SIMULATED_LOCAL`; la suite también validó S3 presigned PUT/GET con un archivo de texto pequeño en LocalStack.

Se amplió el filtro local de Identity para eventos de proyecto/presupuesto/recursos/prioridad. `scripts/init-local.mjs` se ejecutó como inicialización idempotente para aplicar la suscripción; **no cargó seeds ni eliminó filas o volúmenes**. La E2E usa identificadores únicos y no borra datos; quedan unas pocas filas/objetos de prueba en la base local persistente.

No se indujeron fallos para verificar redelivery, DLQ o fallos parciales; tampoco se desplegó una cola AWS para notificaciones. Project aún publica eventos después de escribir sin outbox transaccional.

## 6. AWS y Amplify

- Project Serverless declara la nueva ruta JWT de inteligencia y variables para APIs de dominio.
- Identity Serverless declara las rutas JWT de preferencias/buzón, `NOTIFICATION_MODE=disabled` y recursos DynamoDB existentes.
- Se corrigieron interpolaciones YAML dentro de listas/mapas y se pusieron entre comillas las rutas HTTP con parámetros `{id}` en los seis stacks; también se corrigió el ARN SQS interpolado.
- Los 12 archivos YAML se parsearon con PyYAML y constructor para etiquetas CloudFormation. Esto acredita sintaxis YAML, **no** validación Serverless Framework.
- Serverless Framework no está instalado en el checkout: no se ejecutaron `serverless print/package`. No hubo deploy/remove ni llamadas de creación de recursos AWS.
- Se añadió `amplify.yml` en la raíz del monorepo para instalar desde el lockfile raíz y compilar el workspace frontend a `frontend/dist`. No se validó con Amplify; las URLs públicas `VITE_*`, Cognito y la regla SPA aún deben configurarse en la consola.
- El consumidor de notificaciones permanece exclusivamente local. Consultar [AWS_GALAXY_READINESS.md](docs/AWS_GALAXY_READINESS.md) para dependencias y límites de AWS Academy.

## 7. Reproducibilidad y seguridad

- Se agregó [TEAM_SETUP.md](docs/TEAM_SETUP.md) con pasos Windows, requisitos, instalación, cuentas locales ficticias, pruebas y solución de problemas.
- `.gitignore` excluye `.env*` salvo `.env.example`, `.aws`, claves/certificados, bases SQLite/DB, logs, caches, outputs, archivos de seed report y resultados Playwright. No se borró ningún archivo local.
- Se agregó Playwright y se actualizaron `package.json`/`package-lock.json`. `npm ci --dry-run --ignore-scripts` terminó correctamente.
- `npm audit` informó inicialmente una vulnerabilidad alta en `@faker-js/faker` hasta 10.4.0; el advisory indica versión corregida desde 10.5.0 ([GHSA-qxc2-j82w-r537](https://github.com/advisories/GHSA-qxc2-j82w-r537)). Se actualizó el lock a 10.6.0 ([release](https://github.com/faker-js/faker/releases/tag/v10.6.0)), sin ejecutar generadores; el resultado posterior de auditoría fue 0 vulnerabilidades.
- El escaneo de patrones comunes de claves AWS/PEM/GitHub no devolvió coincidencias en el código inspeccionado. Sigue existiendo autenticación demo y fallback JWT explícitamente local en `scripts/local-api.mjs`; no reutilizarlos en AWS ni tratar como secreto de producción.
- Las trazas Playwright locales están ignoradas por Git. El checkout sin metadatos Git impide verificar staged/tracked o afirmar que el contenido versionado sea seguro.

## 8. Pruebas ejecutadas

| Verificación | Resultado | Qué respalda |
|---|---|---|
| `npm test` | 18/18 aprobadas | Pruebas Node existentes de UTF-8, auth, RBAC, tenant y validación de referencias. |
| `py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q` | 18 aprobadas | Pruebas Python existentes de servicios/operaciones. |
| `py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service tests` | Aprobado | Lint Python. |
| `npm run build --workspace frontend` | Aprobado; 2 186 módulos transformados | TypeScript y Vite build del frontend. |
| `npm run test:e2e` (stack/emuladores locales, Chromium) | 2/2 aprobadas | Landing, rutas, login malo/bueno, panel, inteligencia real, preferencias, verificación simulada, ProjectCreated→SQS→buzón, layout móvil, S3 PUT/GET, tenant A/B y MANAGER/VIEWER. |
| `node scripts/init-local.mjs` | Recursos locales listos | Tablas/emuladores y suscripciones configuradas de forma idempotente; no seed. |
| Parse YAML PyYAML | 12/12 archivos | Sintaxis YAML, no resolución de variables, validación Serverless ni despliegue. |
| `npm audit` | 0 vulnerabilidades después de actualizar Faker | Resultado del lockfile local al momento del chequeo. |
| `npm ci --dry-run --ignore-scripts` | Aprobado | Consistencia de lockfile/dependencias en modo dry-run. |

La primera pasada Playwright excedió el timeout de 30 s en un flujo lento de UI/API; se subió el límite a 90 s y se sanitizaron los errores de red de las llamadas autenticadas. La pasada final terminó con 2/2 escenarios en 22.4 s. No se reporta el fallo inicial como PASS.

No se ejecutó: seed demo/full, carga masiva, pruebas de fallos/DLQ, Amplify build remoto, `serverless package`, AWS deployment o rollback. No se midió cobertura.

## 9. Archivos principales modificados o añadidos

- Frontend: `frontend/src/main.tsx`, `frontend/src/style.css`, `frontend/index.html`, `frontend/public/favicon.svg`.
- Backend/contratos: `services/project-service/handler.mjs`, `services/identity-service/handler.mjs`, ambos `serverless.yml`, y YAML de los seis servicios/stack storage para corregir sintaxis.
- Local/eventos: `scripts/local-api.mjs`, `scripts/dev-local.mjs`, `scripts/init-local.mjs`, `scripts/notification-worker.mjs`.
- E2E/dependencias: `playwright.config.ts`, `tests/e2e/astra.spec.ts`, `package.json`, `package-lock.json`, `.gitignore`.
- Docs: `README.md`, `amplify.yml`, `ASTRA_GALAXY_IMPLEMENTATION_REPORT.md`, `docs/TEAM_SETUP.md`, `docs/ASTRA_GALACTIC_ARCHITECTURE.md`, `docs/API_GALAXY_CONTRACTS.md`, `docs/EVENTS.md`, `docs/AWS_GALAXY_READINESS.md`, `docs/ASTRA_GALAXY_LANDING.png`.

## 10. Riesgos y siguientes pasos

1. Recuperar/abrir el checkout Git real del repositorio autorizado; inspeccionar `status`, remoto, rama, staged, secretos y tamaño de archivos antes de publicar. Actualmente no se puede preparar un commit seguro ni verificar origen.
2. Implementar y probar consumer AWS de notificaciones y límites/permisos de laboratorio, con DLQ y observabilidad.
3. Completar proveedor WhatsApp Business oficial y verificación externa; mantenerlo desactivado hasta revisión de consentimiento/políticas.
4. Agregar scheduler solo tras verificar permisos AWS Academy. Actualmente daily/weekly no se envían.
5. Paginación completa/rate limits distribuidos para consultas de inteligencia y pruebas de errores/latencia de APIs dependientes.
6. Ejecutar `serverless print/package` con framework y variables de laboratorio cuando estén disponibles; después validar Amplify y reglas de rutas SPA, sin desplegar hasta autorización.
7. Probar tablet y accesibilidad con teclado/lector de pantalla; la suite actual solo verifica escritorio y móvil básico.

No se publicaron cambios. Una vez restaurado el directorio Git, primero presentaré el inventario concreto de archivos seguros a publicar y luego esperaré la confirmación requerida antes del `push`.
