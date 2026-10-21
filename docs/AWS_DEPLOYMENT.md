# Preparación y despliegue AWS

`project-service` requiere `DOCUMENTS_BUCKET` con el nombre del bucket producido por `infrastructure/storage`; su rol necesita `s3:GetObject` y `s3:PutObject` solo en ese bucket. Configura CORS del bucket con los orígenes reales del frontend para GET/PUT prefirmados. Esta ruta no se desplegó ni validó en AWS.

## Estado

El repositorio contiene Serverless Framework v4 en seis carpetas de servicios y stacks separados para Cognito, eventos y bucket S3. Los servicios usan Node.js 20 y DynamoDB. El diseño no se desplegó ni se validó mediante `serverless package/deploy` durante esta documentación. La misión prohíbe desplegar en AWS sin autorización explícita; no se ha desplegado.

## Recursos declarados

- Un Cognito User Pool y cliente público sin secreto, con atributos custom de tenant y rol.
- Un SNS Topic, una SQS para Budget, DLQ y suscripción filtrada `ProjectCreated`.
- Un bucket privado con Public Access Block y cifrado AES256.
- Cada microservicio crea tabla DynamoDB on-demand, PITR y HTTP API JWT authorizer.
- Budget service configura consumidor SQS con `ReportBatchItemFailures`.

S3 aún no tiene función de upload/download. La política IAM de servicio declara permisos generales por su tabla y SQS/SNS donde aplica; la revisión de mínimo privilegio y recursos de ARN debe completarse antes de producción.

## Flujo de despliegue descrito por README (requiere verificación)

1. Instalar dependencias y Serverless Framework v4; revisar licencia/login del framework y región elegida.
2. Desplegar `infrastructure/auth`, registrar salidas de User Pool y Client.
3. Desplegar `infrastructure/events`, registrar Topic y Queue ARNs.
4. Desplegar `infrastructure/storage`.
5. Para cada servicio, definir `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `DOMAIN_TOPIC_ARN`, `BUDGET_QUEUE_ARN`, `CORS_ORIGIN` y ejecutar `npx serverless deploy --stage dev`.
6. Configurar `VITE_*` del frontend y publicar con Amplify usando `frontend/amplify.yml` y `appRoot=frontend`.

Estas instrucciones provienen del README; no son evidencia de que el proceso completo haya sido ejecutado. En PowerShell, adaptar las asignaciones de variables del README, que están escritas en sintaxis tipo POSIX.

## Stages y secretos

Los YAML declaran `dev` por defecto y aceptan `--stage`; no se encontraron archivos separados completos de configuración `local`, `dev` y `prod`. Antes de producción: fijar regiones/stages por entorno, parametrizar dominios CORS específicos, configurar alarmas y retención de logs, revisar políticas IAM y habilitar controles de costo. No versionar secretos ni Account IDs; preferir SSM Parameter Store/Secrets Manager y roles de despliegue con permisos limitados.

## Objetivos pendientes antes de afirmar preparación productiva

- Validar `serverless package` para los seis servicios y tres stacks de infraestructura.
- Confirmar dependencias correctas: root `install:all` refiere nombres `services/identity` etc., mientras el árbol auditado usa `services/identity-service`; no se verificó el script.
- Resolver que los seis servicios actualmente son Node.js, pese al objetivo de tres servicios Python.
- Especificar arquitectura local con DynamoDB Local/LocalStack y adaptadores compatibles; hoy no hay Compose.
- Implementar outbox, API de documentos S3 y políticas tenant-scoped de acceso a objetos.
- Incorporar presupuesto/alertas de costo, alarmas operativas, trazas y retención apropiada.
- Ejecutar validación real de Amplify build y configurar variables requeridas.
- No efectuar despliegue AWS como parte de validación local.
