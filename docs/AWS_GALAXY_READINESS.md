# AWS Academy: preparación ASTRA Galaxy

**No se desplegaron recursos.** Este documento separa configuración declarada de validación real. El endpoint de Project Intelligence y rutas Identity de preferencias se declararon en Serverless, pero eso no acredita empaquetado, permisos correctos ni servicio ejecutado en AWS.

## Variables que debe configurar el equipo

- `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID` existentes en el laboratorio, sin guardar sus valores en Git.
- `PORTFOLIO_API_URL`, `PROJECT_API_URL`, `BUDGET_API_URL`, `RESOURCE_API_URL`, `PRIORITY_API_URL` con URLs reales obtenidas de outputs del laboratorio.
- `DOMAIN_TOPIC_ARN` y `DOCUMENTS_BUCKET` ya requeridos por los stacks actuales.
- `NOTIFICATION_MODE=disabled` hasta disponer de consumidor/adapter oficial probado. No habilitar `local-simulator` en AWS.
- Región/stage explícitos y rol de laboratorio únicamente si el flujo de AWS Academy lo permite.

Project Intelligence propaga el token Cognito del usuario hacia APIs HTTP protegidas. Hay que validar que Lambda pueda alcanzar los endpoints, que el API Gateway de destino acepte el JWT del mismo issuer/audience y que los handlers reciban el bearer para autorizar tenant. Sin esa verificación la ruta debe tratarse como no disponible. No ampliar IAM a `*` ni inventar ARN/ID de laboratorio para que el packaging parezca válido.

Identity preferences usa la tabla de Identity ya existente; las APIs de verificación de WhatsApp responden `503` en modo cloud deshabilitado. No existe aún queue-to-Lambda consumer AWS, modelo de entrega real, plantillas WhatsApp aprobadas, idempotencia de proveedor, configuración de retries/DLQ operacional ni consentimiento verificado externamente. El scheduler de recordatorios está declarado, pero sin packaging o verificación AWS Academy. No afirmar integración WhatsApp.

La cola Identity y el worker que implementa eventos notificación son **solo locales**. El stack AWS `infrastructure/events/serverless.yml` sigue declarando ProjectCreated→Budget; no se agregó una cola AWS sin consumer real. Antes de declarar este flujo listo, agregar consumer Lambda, mapping SQS, permisos de lectura/borrado, DLQ específica, alarma, contratos versionados y pruebas de duplicados/errores.

## Amplify

Se agregó `amplify.yml` en la raíz del monorepo: `npm ci`, build del workspace frontend y artefactos `frontend/dist`. No se validó en una build de Amplify. Debe configurarse la regla SPA para servir `index.html` a rutas `/login`, `/register` y `/app/*`, API URLs y Cognito desde configuración de entorno. No poner secretos de servidor en variables Vite (todo `VITE_*` es público).

## Orden y límites de despliegue

1. Consultar al instructor/laboratorio qué servicios, roles y permisos IAM están permitidos.
2. Configurar región/stage y parámetros de Cognito y bucket existentes; revisar cada stack (`auth`, `storage`, `events`, luego Identity y dominios, frontend al final).
3. Desplegar solo después de autorización y validar outputs de tablas, APIs, tópico, colas y bucket. Conectar URLs de servicios y verificar claims JWT tenant-scoped.
4. Ejecutar CRUD acotado con dos tenants y verificar CloudWatch, SQS/DLQ y autorización.
5. Antes de rollback, preservar datos; rollback de CloudFormation no debe tratarse como borrado seguro de recursos con estado.

No se ha establecido compatibilidad del paquete Serverless v4 con credenciales/rol AWS Academy ni se ejecutó `serverless package`/`deploy`. No hay ARNs de rol o IDs inventados en este documento.

## Recordatorios Orbital

Identity ahora declara `cloudportfolio-reminders-${stage}` con GSI `DueIndex`; el Lambda de API tiene permisos DynamoDB de alcance a RecordsTable, RemindersTable y su índice. Se declaró una función EventBridge `rate(1 minute)` que ejecuta el mismo handler scheduler. El runtime local ejecuta el poller persistente con tablas locales.

Esto no equivale a validación AWS: no se ha empaquetado el handler, inspeccionado el template CloudFormation producido ni comprobado límites/cuotas del laboratorio. El GSI usa una partición lógica global de pendientes (`REMINDER#ACTIVE`), que debe revisarse para cargas superiores a una demo. No hay entrega AWS a un canal de notificaciones; el scheduler solo escribe el buzón DynamoDB local en este código. El consumer SNS/SQS de alertas de dominio también permanece local. WhatsApp está deshabilitado.

Project declara POST/GET de reportes y GET por identificador; el historial y filas se guardan en la tabla propia del servicio. Las consultas salientes requieren URLs API válidas y, para APIs Cognito HTTP API, `execute-api:Invoke` y compatibilidad issuer/audience. Esos permisos/URLs no están todavía acreditados por empaquetado o pruebas cloud.

Identity usa `PROJECT_API_URL` para validar proyectos y ejecutar la creación de tareas con el mismo JWT del actor. El servicio Project vuelve a validar autorización y tenant; no hay permiso IAM `execute-api:Invoke` adicional porque esta API usa autorización JWT. Configura `PROJECT_API_URL` desde el endpoint real de salida de Project API, sin copiarlo al frontend.

El Lambda `reminderScheduler` está declarado en Identity mediante EventBridge `rate(1 minute)` y consulta el GSI DueIndex. La propuesta para crear tareas requiere `PROJECT_API_URL`; la API no permite elegir endpoints. No se han desplegado ni validado estas rutas/funciones en AWS Academy.
