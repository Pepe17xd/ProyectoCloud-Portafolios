# WhatsApp Business Cloud API en ProFiles

ProFiles conserva el buzón interno aunque el proveedor externo esté deshabilitado. La ruta real usa el proveedor oficial Meta Cloud API, una cola SQS, el consumidor Lambda de Identity, preferencias por usuario y una tabla DynamoDB con partición por organización. La aplicación web nunca recibe credenciales Meta.

## Variables opcionales de `.env`

Parte de `.env.example`; el archivo `.env` real está excluido de Git. Para desplegar sin WhatsApp, deja `WHATSAPP_META_ENABLED=false` y `NOTIFICATION_MODE=disabled`. No se crea ni modifica ningún secreto Meta en ese modo.

Para habilitar el proveedor durante `npm run deploy:academy`, configura:

```dotenv
WHATSAPP_META_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID del emisor>
WHATSAPP_WABA_ID=<WABA ID; opcional para el envío, requerido para la suscripción manual>
WHATSAPP_ACCESS_TOKEN=<token de usuario del sistema>
WHATSAPP_APP_SECRET=<secreto de la aplicación Meta>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<valor aleatorio de al menos 16 caracteres>
WHATSAPP_GRAPH_VERSION=<versión Graph actualmente soportada por Meta, formato vX.Y>
WHATSAPP_TEMPLATES_APPROVED=true
WHATSAPP_TEMPLATE_VERIFICATION_NAME=profiles_verification
WHATSAPP_TEMPLATE_VERIFICATION_LANGUAGE=es
WHATSAPP_TEMPLATE_REMINDER_NAME=profiles_reminder
WHATSAPP_TEMPLATE_REMINDER_LANGUAGE=es
WHATSAPP_TEMPLATE_RISK_ALERT_NAME=profiles_risk_alert
WHATSAPP_TEMPLATE_RISK_ALERT_LANGUAGE=es
WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_NAME=profiles_weekly_summary
WHATSAPP_TEMPLATE_WEEKLY_SUMMARY_LANGUAGE=es
```

`WHATSAPP_TEMPLATES_APPROVED=true` es una confirmación administrativa: actívala únicamente después de comprobar en Meta que cada plantilla está aprobada y que sus variables de cuerpo coinciden con ProFiles. El despliegue no consulta la cuenta Meta ni verifica el estado de aprobación. Elige `WHATSAPP_GRAPH_VERSION` según la [tabla oficial de versiones de Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions/) y el contrato vigente de [WhatsApp Cloud API Messages](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages). `WHATSAPP_TEMPLATE_AUTOMATION_*` es opcional mientras no haya un evento independiente de ese tipo.

Con `WHATSAPP_META_ENABLED=true`, también se puede configurar `WHATSAPP_META_SECRET_ARN` para reutilizar un secreto existente. El ARN debe pertenecer a la misma cuenta, región y stage, con nombre `cloudportfolio/whatsapp/<account>/<stage>-<sufijo>` y contener el mismo esquema completo con `templatesApproved: true`. No combines el ARN con credenciales Meta en `.env`.

## Secretos y despliegue AWS Academy

`npm run deploy:academy:check` valida las variables sin escribir secretos ni recursos. Al desplegar con credenciales Meta completas, el orquestador usa el SDK de AWS en memoria para crear o versionar el secreto `cloudportfolio/whatsapp/<account>/<stage>` en Secrets Manager. Comprueba que la versión `AWSCURRENT` se puede leer y entrega a Serverless solo el ARN. Los valores Meta se eliminan del entorno de los procesos AWS CLI, Serverless y Vite; no se pasan como argumentos, variables Lambda, parámetros de CloudFormation, archivos generados ni variables `VITE_*`.

Una rotación crea una nueva versión con `AWSCURRENT`; las versiones anteriores permanecen bajo la gestión de Secrets Manager. La herramienta no rota tokens por sí misma: genera la versión cuando se ejecuta de nuevo con valores nuevos. No sobrescribe una versión si falta cualquier campo obligatorio. Si la lectura o escritura se deniega, WhatsApp queda desactivado y el orquestador continúa con el despliegue normal de ProFiles y el buzón interno; nunca usa texto plano como alternativa. Un secreto recién creado puede quedar almacenado si una política deniega luego la lectura; permanece cifrado en Secrets Manager y no se activa en Lambda.

El LabRole preexistente necesita, como mínimo:

- En despliegue: `secretsmanager:DescribeSecret`, `secretsmanager:CreateSecret`, `secretsmanager:PutSecretValue` y `secretsmanager:GetSecretValue`. `CreateSecret` puede requerir `Resource: *`, restringido por `aws:RequestTag/Application = ProFiles`; el resto se puede limitar al ARN `cloudportfolio/whatsapp/<account>/<stage>-*`.
- Para que el orquestador confirme previamente el acceso del rol de ejecución: `iam:SimulatePrincipalPolicy`. Si Academy no permite esta comprobación, WhatsApp queda desactivado por seguridad y el resto de ProFiles puede desplegarse.
- En ejecución de Lambda: `secretsmanager:GetSecretValue` sobre el secreto del stage.
- Para el circuito de avisos: los permisos SQS y DynamoDB ya declarados para el rol de Identity.

El despliegue Academy reutiliza LabRole y no crea roles ni intenta cambiar su política. Si el laboratorio no concede estos permisos, WhatsApp queda sin activar y el resto de ProFiles se despliega en modo de buzón interno. El operador debe solicitar los permisos al administrador del laboratorio; no copies secretos a variables Lambda para sortear la restricción.

Comandos:

```bash
npm ci
npm run deploy:academy:check
npm run deploy:academy
```

El despliegue muestra las seis URLs API y la URL exacta `https://<Identity API>/webhooks/meta/whatsapp`. No contacta Meta ni configura la suscripción en la cuenta externa.

## Preparar el webhook en Meta

En el panel de desarrolladores de Meta, configura el callback con la URL mostrada por el orquestador y el mismo `WHATSAPP_WEBHOOK_VERIFY_TOKEN` guardado en Secrets Manager. Suscribe la aplicación al objeto WABA y al campo `messages`. ProFiles no hace cambios en la cuenta Meta. El endpoint valida el token en la verificación GET y valida `X-Hub-Signature-256` sobre el cuerpo original en cada POST. El webhook actualiza estados persistentes, ignora eventos duplicados y procesa palabras de baja (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `PARAR`, `BAJA`).

## Recorrido de mensajes

1. El usuario acepta explícitamente el consentimiento y verifica posesión del número mediante la plantilla Meta configurada.
2. Preferencias, consentimiento, verificación y horario permitido se guardan por `tenantId` y usuario autenticados.
3. Recordatorios y automatizaciones consultan el estado y encolan solo a suscriptores elegibles. Para informes de automatización, Identity obtiene la lista de membresías activas del tenant y genera un mensaje independiente por integrante; el cliente no puede elegir destinatarios, rol ni tenant.
4. El informe ADMIN/MANAGER puede incluir proyectos, alertas y presupuestos dentro de su alcance autorizado. El informe de una persona VIEWER incluye únicamente proyectos propios o con tareas asignadas, sus tareas y sus vencimientos; no contiene presupuestos de organización.
5. El consumidor vuelve a comprobar consentimiento, estado de verificación, preferencias y horario antes de enviar la plantilla aprobada.
6. Un `200` de Graph API solo se registra como `ACCEPTED_BY_META`. `SENT`, `DELIVERED`, `READ` y `FAILED` solo provienen de eventos firmados del webhook.

Los reintentos SQS cubren fallas transitorias. Si el resultado HTTP es ambiguo, queda `UNKNOWN` y no se reenvía automáticamente para reducir el riesgo de mensajes duplicados. Las claves de idempotencia se limitan a organización, usuario, flujo y ejecución.

## Rutas del servicio

| Método y ruta | Acceso | Uso |
| --- | --- | --- |
| `GET /notifications/whatsapp` | Cognito | Disponibilidad, estado, preferencias e historial del usuario autenticado |
| `POST /notifications/whatsapp/verification` | Cognito | Consentimiento, número E.164 y solicitud de código |
| `POST /notifications/whatsapp/confirm` | Cognito | Validación del código vigente |
| `PUT /notifications/whatsapp/preferences` | Cognito | Eventos permitidos, zona horaria y horas |
| `DELETE /notifications/whatsapp/number` | Cognito | Revocación y eliminación del número |
| `GET /webhooks/meta/whatsapp` | Callback Meta | Verificación de suscripción |
| `POST /webhooks/meta/whatsapp` | Callback Meta firmado | Estados y bajas |

La configuración de eventos no autoriza por sí sola envíos: consentimiento vigente, número real verificado, disponibilidad del proveedor, plantilla y horario permitido se vuelven a verificar en el consumidor.

## Pruebas locales y límites

```bash
npm test
npm run test:whatsapp:integration
```

La integración local levanta DynamoDB Local y SQS compatible, ejecuta Identity por HTTP, consume la cola con el procesador Lambda y llama a un servidor HTTP Meta simulado. Prueba verificación aislada, consentimiento, preferencias, idempotencia, webhook firmado/falsificado, revocación y separación de organizaciones. No contacta Meta ni envía mensajes reales.

El proveedor de verificación local y las credenciales Meta simuladas están bloqueados en Lambda y `NODE_ENV=production`. El entorno de prueba de Meta también tiene restricciones de números, plantillas, permisos y límites propias; la simulación local no las representa. Antes de anunciar disponibilidad real, hay que desplegar en una cuenta AWS autorizada, aprobar plantillas y hacer un envío y webhook de extremo a extremo autorizados. Esta implementación local no constituye esa validación.
