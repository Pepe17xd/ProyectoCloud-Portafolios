> Reporte base anterior a la suite Orbital actual; consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](../ASTRA_ORBITAL_RELEASE_REPORT.md).

# Reporte de validación local

Fecha: 21 de octubre de 2026 (America/Lima). Resultados de esta sesión; no implica despliegue en AWS.

## Aprobado con evidencia

| Área | Resultado |
|---|---|
| Docker Desktop | Engine Linux amd64 en WSL2, contexto `desktop-linux`; Compose v5.5.1. DynamoDB Local y LocalStack quedan `healthy`. |
| Inicialización | `npm run dev:local` terminó la inicialización de las seis tablas, bucket S3 privado, topic SNS, seis colas de servicio y DLQ; luego levantó los seis APIs, worker y Vite. |
| API health | GET `/healthz` respondió 200 en puertos 4101–4106. Frontend `http://localhost:5173/` respondió 200. |
| Autenticación | Login admin Tenant A/B; `/auth/me` devolvió los claims del token firmado. |
| Flujo de negocio HTTP | Se crearon proyecto y tarea, recurso y asignación, presupuesto y gasto; resumen confirmó gasto 100 y saldo calculado; recálculo de prioridad produjo score 87.25. |
| Aislamiento tenant | Tenant B recibió 404 al leer, editar y eliminar el ID de proyecto creado en Tenant A. Tenant A pudo operarlo. La consulta usa clave particionada por tenant. |
| RBAC | VIEWER recibió 403 al crear un proyecto; ADMIN pudo crear. No se verificaron todos los permisos para cada ruta. |
| Eventos | Crear proyecto publicó `ProjectCreated`; consumidor Python de Budget recibió el evento vía SNS→SQS y persistió un presupuesto inicial en el tenant del proyecto. |
| S3 | DevOps verificó PutObject/GetObject local y contenido recuperado `persisted`; bucket con bloqueo de acceso público. |
| Seed demo | `npm run seed:demo` persistió 360 registros ficticios: 20 por cada uno de los seis servicios en cada uno de tres tenants. El reporte `seed-report-demo.json` incluye conteos leídos desde DynamoDB. |
| Suite Node | `npm test`: 12/12 aprobadas. Incluye JWT válido, ausente, adulterado y expirado, permisos y aislamiento de claves/cursor. |
| Suite Python | `py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q`: 7/7 aprobadas. |
| Ruff | `py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service`: aprobado. |
| Frontend | `npm run build --workspace frontend`: TypeScript y Vite aprobados; 2,186 módulos transformados. Rollup/esbuild nativos Windows se resolvieron al reinstalar dependencias opcionales sin modificar versiones ni lockfile. |
| Configuración Compose | `docker compose -f infrastructure/docker-compose.yml config --quiet`: aprobado. |

## No ejecutado o pendiente

- Playwright/E2E de navegador: no se instaló ni ejecutó Playwright; el flujo HTTP validó las APIs directamente.
- Aislamiento de Tenant B sobre todas las rutas y servicios Python: se verificó CRUD de proyecto del servicio TypeScript y no todo el espacio de rutas.
- RBAC completo por endpoint; solo se confirmó rechazo 403 de escritura por VIEWER.
- DLQ, redelivery/reintentos y duplicación de mensajes mediante prueba deliberada.
- Upload/download S3 por URL firmada a través del API del proyecto (se probó S3 SDK directamente).
- Seed full: no ejecutado; los 180,000 registros objetivo no están cargados. `seed:full` configura 10,000 filas por tenant y servicio, pero debe correrse y verificarse explícitamente.
- Empaquetado Serverless de los seis servicios no ejecutado; no hubo despliegue AWS.
- Python local corrió en 3.11.9 porque 3.12 no está instalado; Serverless queda configurado con runtime Python 3.12.

## Correcciones encontradas durante integración

- Health check DynamoDB respondía HTTP 400 de autenticación al endpoint `/shell/`; se acepta esa respuesta como señal del servidor activo. El volumen Docker nuevo era root-owned aunque DynamoDB corre como UID 1000; se añadió servicio de permisos scoped al volumen del proyecto, sin eliminar datos.
- Las llamadas al SDK desde Node en Windows se colgaban usando `localhost` contra endpoints de contenedor; la inicialización ahora corre en un contenedor Node dentro de la red Compose.
- `scripts/local-api.mjs` necesitaba `pathToFileURL()` para importar handlers Windows y una allowlist para rutas de tenants/memberships y subtareas.
- DynamoDB boto3 no serializa `float`; Resource/Budget/Priority convierten a `Decimal` antes de persistir.
- La consulta de proyectos filtraba por la sort key primaria usando FilterExpression; se movió a KeyConditionExpression.
- El worker local usa fallback a Python 3.11 cuando el runtime 3.12 no existe.
