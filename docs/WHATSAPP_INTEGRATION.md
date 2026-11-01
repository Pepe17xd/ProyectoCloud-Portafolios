# WhatsApp Business en ProFiles

## Recorrido

Los ajustes de WhatsApp se guardan en el registro de preferencias bajo `TENANT#<tenantId>` y el `sub`/usuario autenticado. El cliente nunca envía tenant, destinatario o rol. Un alta exige número E.164, consentimiento/versionado, código con vencimiento y preferencias. En producción, el código se envía con una plantilla aprobada de Meta y la cuenta queda verificada únicamente después de validarlo. El proveedor de pruebas marca `verified-test`, nunca `whatsappVerified`, y está bloqueado en Lambda.

Recordatorios vencidos y ejecuciones de automatización consultan esas preferencias antes de publicar un mensaje mínimo a SQS. Identity tiene un consumidor Lambda asociado a la cola; vuelve a comprobar consentimiento, verificación, horario y tipo de evento inmediatamente antes de llamar al proveedor. Las reclamaciones condicionales de DynamoDB evitan envíos duplicados. Respuestas transitorias de Meta (429/5xx) se reintentan desde SQS y terminan en DLQ; un resultado de red ambiguo queda `UNKNOWN` y no se reenvía automáticamente.

El webhook público es `/webhooks/meta/whatsapp`. GET realiza la verificación de suscripción. POST exige `X-Hub-Signature-256` sobre los bytes originales, guarda estados `sent`, `delivered`, `read` y `failed`, deduplica eventos y conserva por un periodo limitado callbacks que llegan antes del registro del ID de mensaje. Mensajes entrantes `STOP`, `UNSUBSCRIBE`, `CANCEL`, `PARAR` o `BAJA` revocan las preferencias encontradas mediante un índice HMAC de número.

## Rutas

Todas requieren el JWT de Cognito, salvo el webhook:

| Método y ruta | Uso |
| --- | --- |
| `GET /notifications/whatsapp` | Estado del canal, configuración del proveedor, preferencias e historial |
| `POST /notifications/whatsapp/verification` | Número, consentimiento explícito y solicitud de código |
| `POST /notifications/whatsapp/confirm` | Confirmar código vigente |
| `PUT /notifications/whatsapp/preferences` | Eventos, zona horaria y horario permitido |
| `DELETE /notifications/whatsapp/number` | Revocar consentimiento, borrar el número y cancelar preferencias |
| `GET /notifications/verification-inbox` | Código exclusivo del proveedor de pruebas local |
| `GET /webhooks/meta/whatsapp` | Suscripción del webhook Meta |
| `POST /webhooks/meta/whatsapp` | Estados y bajas firmadas por Meta |

El historial distingue `ACCEPTED_BY_META` de `SENT`, `DELIVERED`, `READ` y `FAILED`. Aceptación de una solicitud por Meta no se presenta como entrega al usuario.

## Desarrollo local e integración

Requisitos: Node.js 20+, npm y Docker Compose. Desde la raíz:

```bash
npm ci
npm run test:whatsapp:integration
npm run dev:local
```

La prueba integrada levanta DynamoDB Local y LocalStack SQS, inicia la API Identity por HTTP, consume la cola con el mismo procesador usado por Lambda y llama a un servidor HTTP Meta simulado. No configura AWS, no usa credenciales AWS y no envía mensajes reales. El código de verificación local solo sirve para ejercitar el recorrido; no demuestra posesión de un teléfono. Los servicios de desarrollo quedan ejecutándose después de la prueba para que el volumen local pueda reutilizarse.

En la aplicación local, el buzón interno sigue operativo cuando Meta no está configurado. La configuración local activa `integration-test` explícitamente y las rutas de prueba están bloqueadas si `AWS_LAMBDA_FUNCTION_NAME` existe o `NODE_ENV=production`.

## Preparar Meta real

Se necesita una aplicación Meta con WhatsApp Business Cloud API habilitada, un WABA y número emisor elegibles, un token de usuario del sistema con acceso a ese WABA/número, Phone Number ID, secreto de aplicación y plantillas aprobadas por Meta. Configure las plantillas y códigos de idioma exactos. El alta necesita una plantilla `verification` que acepte el código como parámetro. Las notificaciones iniciadas por ProFiles necesitan plantillas aprobadas para los tipos que se habiliten (`reminder`, `automation`, `risk-alert`, `weekly-summary` y los eventos de dominio usados por la organización).

Guarde el token, secreto de aplicación, datos del emisor, plantillas y token de verificación del webhook en un secreto de **AWS Secrets Manager** con este formato. El ejemplo no contiene valores reales:

```json
{
  "accessToken": "<Meta system-user token>",
  "phoneNumberId": "<Meta Phone Number ID>",
  "graphVersion": "v22.0",
  "appSecret": "<Meta app secret>",
  "webhookVerifyToken": "<random webhook verification token>",
  "templates": {
    "verification": { "name": "profiles_verification", "language": "es" },
    "reminder": { "name": "profiles_reminder", "language": "es" },
    "automation": { "name": "profiles_automation", "language": "es" },
    "risk-alert": { "name": "profiles_risk_alert", "language": "es" },
    "weekly-summary": { "name": "profiles_weekly_summary", "language": "es" }
  }
}
```

No guarde el JSON del secreto en Git, `.env`, variables `VITE_*`, CloudFormation outputs o logs. En el `.env` de despliegue solo configure referencias no secretas:

```dotenv
NOTIFICATION_MODE=meta
WHATSAPP_META_SECRET_ARN=arn:aws:secretsmanager:<region>:<cuenta>:secret:profiles-whatsapp-<sufijo>
```

`npm run deploy:academy` obtiene dinámicamente la URL de Identity y añade la cola de salida y el consumidor al stack Events/Identity existente. Configure el webhook de Meta hacia `https://<Identity API URL>/webhooks/meta/whatsapp`; use el mismo secreto guardado para validar la suscripción. El endpoint comprueba la firma del cuerpo POST con el secreto de aplicación.

## Permisos y límites de AWS Academy

La cola SQS y DLQ se agregan al stack Events, y el índice de número al stack DynamoDB de Identity. El despliegue continúa sin Meta: con `NOTIFICATION_MODE=disabled` o un secreto ausente el canal se informa como no disponible y no encola envíos WhatsApp. La cola no se sustituye por un envío simulado.

En modo LabRole, el rol existente debe permitir a Identity: `sqs:SendMessage`, `ReceiveMessage`, `DeleteMessage`, `ChangeMessageVisibility` y `GetQueueAttributes` sobre la cola WhatsApp; `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query` y `TransactWriteItems` sobre la tabla e índices Identity; y `secretsmanager:GetSecretValue` sobre el ARN configurado. La integración usa la misma política IAM preexistente LabRole y no crea roles. AWS Academy puede no permitir ampliar esa política, habilitar Secrets Manager, registrar el Event Source Mapping o ejecutar la tarea programada. En ese caso WhatsApp real permanece deshabilitado; no se debe copiar el token a variables públicas para sortearlo.

La prueba local demuestra comportamiento de la aplicación contra emuladores y un proveedor HTTP controlado, no la aprobación de plantillas, calidad de entrega, límites, opt-in regulatorio ni disponibilidad de Meta real. Esos puntos requieren una cuenta WABA y una prueba autorizada.
