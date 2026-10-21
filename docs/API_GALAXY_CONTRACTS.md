# Contratos API de ASTRA Orbital

Todos los endpoints requieren JWT. Tenant y usuario se obtienen exclusivamente de claims verificados; no se acepta autoridad `tenantId`/`userId` del body. Los endpoints pertenecen a las APIs Project e Identity existentes.

## Inteligencia de consulta

### `POST /intelligence/ask` — Project API

Body `{ "question": "¿Qué proyectos están atrasados?" }`; 1–500 caracteres. Consulta una allowlist de APIs GET con el bearer del usuario y tareas de la tabla propia Project. Devuelve hechos, sugerencias, servicios no disponibles y alcance de primera página (máximo 100 filas por dominio). Límite en memoria: 20 consultas/minuto/usuario/instancia. No ejecuta cambios ni usa LLM.

## Propuestas y recordatorios

### `POST /intelligence/proposals` — Identity API

Body `{ "text": "Recuérdame revisar el presupuesto mañana a las 09:00", "timezone": "America/Lima", "recurrence": "ONCE" }`. El intérprete determinista admite únicamente `Recuérdame <descripción> hoy|mañana|YYYY-MM-DD a las HH:MM`; rechaza frases ambiguas y fechas pasadas o a más de 366 días. La zona debe estar en la base de zonas IANA. `recurrence` es `ONCE`, `DAILY` o `WEEKLY` y por defecto `ONCE`.

Respuesta `201`: propuesta persistida `PENDING_CONFIRMATION`, expiración de 15 minutos, descripción, instante UTC, zona y recurrencia. No crea el recordatorio.

### `POST /intelligence/actions/{proposalId}/confirm` — Identity API

Body `{ "operationId": "<UUID aleatorio del cliente>" }`. Revalida propiedad, vigencia y estado; una escritura condicional evita duplicados. Repetir la misma operación devuelve el recordatorio existente (`idempotentReplay: true`); usar otro operationId devuelve `409`. Confirmar crea el recordatorio y registra actor/acción sin secretos.

### `GET /intelligence/actions`

Devuelve hasta 50 propuestas del usuario autenticado como historial.

El parser soporta además el formato explícito `Crear tarea "<título>" en proyecto <id>`. Antes de proponer, Identity consulta `GET /projects/{id}` en Project API con el mismo JWT; la tarea solo se crea tras confirmar. Solo ADMIN/MANAGER pueden usar esta herramienta. La confirmación llama `POST /projects/{id}/tasks`; Project vuelve a autorizar con el JWT y persiste marcador de idempotencia + tarea mediante `TransactWriteItems`. El mismo operationId devuelve la tarea previa aun si Identity falla después de la escritura. Ningún texto puede elegir URL, código o tabla.

### `GET /reminders`

Devuelve hasta 100 recordatorios del usuario dentro del tenant autenticado. El servicio persiste claves `pk=TENANT#<tenant>` y `sk=REMINDER#<user>#<id>` en la tabla exclusiva `cloudportfolio-reminders-*`.

### `PATCH /reminders/{id}`

Admite campos `title`, `dueAt` (ISO-8601), `timezone`, `recurrence` y/o estado `SCHEDULED`, `PAUSED`, `COMPLETED`. Solo el propietario puede editar su registro. Reactivar requiere una fecha futura válida. Registra una entrada acotada de auditoría.

### `DELETE /reminders/{id}`

Cancela manteniendo historial. No borra físicamente el registro.

### Modelo de recordatorio (ejemplo)

```json
{
  "pk": "TENANT#tenant-a",
  "sk": "REMINDER#user-123#reminder-456",
  "id": "reminder-456",
  "tenantId": "tenant-a",
  "userId": "user-123",
  "title": "revisar el presupuesto",
  "dueAt": "2026-10-22T14:00:00.000Z",
  "timezone": "America/Lima",
  "recurrence": "WEEKLY",
  "status": "SCHEDULED",
  "gsi1pk": "REMINDER#ACTIVE",
  "gsi1sk": "2026-10-22T14:00:00.000Z#reminder-456",
  "operationId": "uuid-idempotente"
}
```

El `DueIndex` consulta recordatorios activos por fecha. El scheduler local consulta lotes de 20, escribe una notificación idempotente en el buzón Identity (`SIMULATED_LOCAL`) y completa el recordatorio puntual o avanza una recurrencia diaria/semanal en su zona. El índice permite recuperar vencimientos tras reinicios. Ejecución cada minuto local configurable (15 segundos por defecto) y función EventBridge `rate(1 minute)` declarada para AWS; ninguno fue desplegado. En caso de un fallo repetido el proceso vuelve a intentar el mismo vencimiento; no se afirma garantía de entrega externa.

## Reportes

### `POST /intelligence/reports` — Project API

Solo ADMIN/MANAGER (persistir historial es una escritura). Body `{ "type": "project-progress" }`. Tipos: `portfolio-status`, `project-progress`, `overdue-tasks`, `resource-usage`, `budgets`, `priorities`, `risks`. Filtros no soportados: si se envían, devuelve `400` en vez de ignorarlos. Las APIs fuente se consultan con el JWT actual; máximo primera página de 100 por servicio. La respuesta incluye CSV UTF-8, metadatos de fecha/tenant/usuario/tipo, servicios fuente, filas y `scope.partial`. Si un servicio no está disponible, se informa en `unavailable` y `partial`.

### `GET /intelligence/reports`

Lista hasta 50 metadatos de reportes persistidos bajo la partición del tenant.

### `GET /intelligence/reports/{id}`

Devuelve los datos y el CSV solo si el reporte pertenece al tenant autenticado; el CSV se regenera desde filas persistidas. No hay exportación PDF ni filtros personalizados. Las monedas se reportan separadas tal como las entrega el servicio; no hay conversión monetaria.

## Notificaciones existentes

| Método | Ruta | Efecto |
|---|---|---|
| GET/PUT | `/notifications/preferences` | Preferencias del usuario autenticado, zona, ventana, frecuencia y tipos permitidos. |
| GET | `/notifications/inbox` | Buzón del usuario dentro de su tenant. |
| POST | `/notifications/whatsapp/verification` | Simulador local requiere consentimiento y E.164; nunca valida teléfono real. |
| GET | `/notifications/verification-inbox` | Código del simulador local exclusivamente. |
| POST | `/notifications/whatsapp/confirm` | Confirma solo el ejercicio local. |
| DELETE | `/notifications/whatsapp/number` | Revoca y elimina el número de preferencias. |

El buzón muestra `Simulado localmente — No enviado a WhatsApp`. WhatsApp Business oficial no está configurado. Los avisos de recordatorio usan el mismo buzón local, no WhatsApp/SNS.

## Contrato de eventos existente

Project publica `eventVersion: 1`; el worker local Identity consume notificaciones SNS/SQS de eventos permitidos y usa `eventId` para idempotencia. El scheduler de recordatorios trabaja directamente contra su tabla y el buzón; no publica un evento SNS. No hay consumer AWS de Identity ni DLQ operacional configurados para notificaciones.
