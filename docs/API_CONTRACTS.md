# Contratos API ASTRA

Cada microservicio publica su propia HTTP API y deriva `tenantId`, `sub` y `role` de claims autenticados. No usar los IDs del body como autoridad de identidad. Todas las APIs de negocio exigen JWT, salvo los health checks del adaptador local. Los errores JSON usan `{ "error": "..." }`.

## Endpoints de dominio

| Servicio | Colección | Campos principales aceptados | Requerido en alta |
|---|---|---|---|
| Identity | `/users` | `name`, `email`, `role`, `status` | `name` |
| Portfolio | `/portfolios` | `name`, `description`, `ownerId`, `status` | `name` |
| Project | `/projects` | `name`, `portfolioId`, `ownerId`, `status`, `startDate`, `endDate` | `name` |
| Resource | `/resources` | `name`, `type`, `capacity`, `status` | `name` |
| Budget | `/budgets` | `projectId`, `allocated`, `spent`, `currency` | `projectId` |
| Priority | `/priorities` | `projectId`, `impact`, `urgency`, `risk`, `alignment` | `projectId` |

Las colecciones admiten `GET`, `POST` y `GET/PATCH/DELETE /{id}` con las restricciones RBAC de la tabla siguiente. `PATCH` filtra campos por allowlist y conserva tenant; claves no encontradas en ese tenant devuelven 404.

| Rol | GET | POST/PATCH | DELETE | Administración Identity |
|---|---|---|---|---|
| VIEWER | Permitido en su tenant | 403 | 403 | Solo lectura |
| MANAGER | Permitido en su tenant | Permitido para PPM | 403 | Solo lectura |
| ADMIN | Permitido en su tenant | Permitido | Permitido | Permitido |

OPTIONS es preflight CORS. `GET /healthz` solo está en los adaptadores locales, no se declara como ruta pública en AWS.

## Listados y validación

`GET /<collection>?limit=50&cursor=<base64url>` responde `{ "items": [...], "nextCursor": string|null }`. El límite predeterminado es 50 y el máximo es 100. Las consultas usan la partición `TENANT#<claim>`; el cursor se valida contra esa misma partición. Los listados no prometen una vista global entre tenants.

Los servicios que reciben una referencia externa consultan la API propietaria con el bearer JWT actual. Project valida Portfolio y perfil propietario; Budget y Priority validan el proyecto; Resource valida proyecto en asignaciones. Una referencia inexistente/ajena falla; la falta de configuración o indisponibilidad del servicio dependiente cierra la escritura con 503. Los servicios no leen directamente las tablas ajenas.

## Project: subtareas, hitos y archivos

- `GET/POST /projects/{id}/tasks`; `GET/PATCH/DELETE /projects/{id}/tasks/{taskId}`. Tarea: `title`, `description`, `status`, `assigneeId`, `dueDate`, `priority`. Estados admitidos: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`.
- `GET/POST /projects/{id}/milestones`; `GET/PATCH/DELETE /projects/{id}/milestones/{milestoneId}`. Hito: `name`, `description`, `dueDate`, `status`.
- `POST /documents` requiere `projectId`, `fileName`, `contentType`, `contentLength`; valida proyecto tenant-scoped, allowlist PDF/PNG/JPEG/TXT/DOCX y tamaño de 1 byte a 20 MB. Devuelve metadatos y URL prefirmada de carga con expiración de 10 minutos.
- `GET /documents?limit=&cursor=` lista metadatos del tenant. `GET /documents/{id}` devuelve metadatos y URL prefirmada de descarga de 10 minutos. El cliente transfiere bytes con PUT/GET directo a S3.
- `POST /projects/{id}/tasks` acepta opcionalmente `idempotencyKey` interno al flujo confirmado ASTRA; Project guarda marcador y tarea en una transacción DynamoDB. Claves válidas de 16–80 caracteres alfanuméricos/guion; el campo no se persiste en la tarea.

## Autenticación local

El adaptador local Identity añade `POST /auth/login` con correo/contraseña demo y `GET /auth/me`. Emite token HS256 de desarrollo con expiración de una hora; sus cuentas ficticias no son Cognito ni están habilitadas en AWS. No reutilizar credenciales/clave locales como configuración de producción.

## Inteligencia, recordatorios y reportes

Los contratos de `POST /intelligence/ask`, propuestas/confirmación, `/reminders`, reportes CSV, scheduler y buzón están definidos en [API_GALAXY_CONTRACTS.md](API_GALAXY_CONTRACTS.md). El modo local aplica reglas deterministas; acciones de escritura requieren confirmar una propuesta estructurada. La documentación distingue límites de página, estado simulado y funciones no disponibles.

La política de errores distingue 400 entrada inválida, 401 autenticación ausente/inválida, 403 rol no autorizado, 404 recurso no visible dentro del tenant, 405 método no permitido, 422 referencias rechazadas y 503 dependencias no disponibles. No exponer tokens ni secretos en mensajes o registros.
