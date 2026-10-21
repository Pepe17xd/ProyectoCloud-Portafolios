# Diseño de datos

## Convenciones

En el código inspeccionado, cada servicio declara su propia tabla DynamoDB (`cloudportfolio-<service>-<stage>`) con clave de partición `pk` y orden `sk`, modo on-demand y PITR habilitado. Los datos usan una partición por tenant (`TENANT#<tenantId>`) y elemento `ITEM#<id>`. El diseño evita joins y acceso a tablas ajenas; relaciones entre servicios son IDs externos.

Cada item lleva campos de dominio, `createdAt` y, normalmente, `createdBy`; PATCH agrega `updatedAt`. La validación del tipo/forma de la entidad está incompleta. No existen GSIs actualmente en las tablas definidas.

## Esquemas observados y propuestos

Los siguientes ejemplos reflejan los campos admitidos hoy, no garantizan que todos los campos opcionales se escriban:

```json
{
  "pk": "TENANT#empresa-a",
  "sk": "ITEM#project-uuid",
  "name": "Migración de plataforma",
  "portfolioId": "portfolio-uuid",
  "ownerId": "user-uuid",
  "status": "PLANNED",
  "startDate": "2026-10-01",
  "endDate": "2027-03-31",
  "createdBy": "cognito-sub",
  "createdAt": "2026-10-20T12:00:00.000Z"
}
```

| Tabla | Datos actuales | Extensión de dominio objetivo |
|---|---|---|
| Identity | `name,email,role,status` | Tenant, Membership, perfil, invitación y AuditEvent. Cognito conserva credenciales; no crear contraseñas en tabla. |
| Portfolio | `name,description,ownerId,status` | Objetivos y snapshots; proyecto vinculado solo por ID. |
| Project | `name,portfolioId,ownerId,status,startDate,endDate` | Tarea, hito y actividad en mismos límites de propietario o items con tipo en SK. |
| Resource | `name,type,capacity,status` | Skills, disponibilidad y Assignment con resourceId/projectId externos. |
| Budget | `projectId,allocated,spent,currency` | Expense, BudgetRevision, alertas y sumarios. |
| Priority | `projectId,impact,urgency,risk,alignment` | Assessment, Criterion, Score y RankingSnapshot con versión de fórmula. |

Los campos de extensión todavía no están implementados como modelos independientes.

## Patrones de acceso actuales

1. Lista de registros del tenant: `Query(pk = TENANT#<tenant>)`, paginación por `LastEvaluatedKey`; Project filtra proyectos por `sk` con prefijo `ITEM#`.
2. Leer un registro: `GetItem(pk = TENANT#<tenant>, sk = ITEM#<id>)`.
3. Crear: `PutItem` condicionado a ausencia de PK/SK.
4. Actualizar: lectura seguida de `PutItem`; no usa condición de versión y puede perder actualizaciones concurrentes.
5. Borrar: `DeleteItem` por clave compuesta.
6. Documentos: Project Service almacena metadata bajo `sk=DOC#<id>` y objetos con prefijo S3 `<tenantId>/<documentId>/...`; URL prefirmadas expiran en 600 s.
7. Seed: BatchWrite por tabla y tenant con IDs deterministas. La verificación cuenta registros `seed=true` con paginación completa y escribe un reporte JSON, cuando se puede ejecutar.

Los patrones 1 y 2 no cruzan tenant porque tenant se extrae de claims JWT. El cursor es base64url y el servicio comprueba que su PK corresponde al tenant; no está firmado.

## Índices para consultas futuras

No añadir GSI sin patrón de acceso concreto. Para filtros comunes de estado y fechas, una opción objetivo sería `GSI1PK = TENANT#<tenant>#STATUS#<status>`, `GSI1SK = <updatedAt>#<id>`. Para asignaciones por persona, usar `GSI1PK = TENANT#<tenant>#RESOURCE#<resourceId>` y `GSI1SK = <startDate>#<assignmentId>`. Diseñar índices por servicio y aplicar `tenantId` en cada partition key; revisar cardinalidad/costos antes de provisionar. Dashboard agregado puede usar snapshots/proyecciones dentro del servicio propietario, no scans transversales.

## Reglas de integridad y seguridad

- Comprobar que cada ID relacionado (proyecto, portafolio, recurso) existe bajo tenant autenticado antes de aceptar referencia.
- Nunca confiar en `tenantId` suministrado en body, query o path.
- Usar condiciones de escritura y control de versión para idempotencia/actualizaciones concurrentes.
- No consultar tabla de otro microservicio; event projections o llamadas al API propietario son los límites válidos.
- Datos de seed deben ser sintéticos y deterministas; cuentas de usuario reales siguen controladas por Cognito.

## Conteos

`scripts/seed-local.mjs` apunta solo a DynamoDB Local, tres tenants y seis tablas. DEMO escribe 20 registros por tenant/servicio; FULL usa 10 000 por tenant/servicio (180 000 en total). No ejecuté el seed, por tanto no hay conteos persistidos certificados.
