# Despliegue preparado para AWS Academy

No se desplegó ni se consultó ningún recurso AWS durante la preparación local. Node/npm dependencias se instalan con `npm ci`; Python 3.12 y AWS CLI deben estar instalados en la VM. Los nueve archivos Serverless fijan CLI/framework `4.17.1`; la ejecución de v4 requiere login/licencia del Framework. Las credenciales temporales se configuran según el laboratorio y nunca se guardan en Git.

## Flujo

```bash
git clone <URL_REPOSITORIO>
cd cloudportfolio
npm ci
```

Configura `AWS_REGION`, `CORS_ORIGIN` (origen HTTPS de Amplify) y los datos de Cognito `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` si se usa un User Pool existente. El orquestador valida identidad STS sin imprimir credenciales. Si los permisos del laboratorio permiten crear Cognito, el stack auth produce esos valores; en tal caso no es necesario preconfigurarlos. Serverless Framework v4 y `serverless-python-requirements` deben estar disponibles. El preflight no instala nada ni crea recursos:

```bash
npm run deploy:academy:check
```

Solo tras confirmar con el instructor los servicios/región permitidos y que CloudFormation puede crear los roles Lambda/API Gateway, ejecutar explícitamente:

```bash
npm run deploy:academy
npm run deploy:academy:verify
```

El despliegue sigue auth → storage → events → identity → portfolio → project → resource → budget → priority. Lee outputs de CloudFormation para Cognito, tópico, cola y bucket; inyecta los necesarios a servicios dependientes. Serverless/CloudFormation conservan stacks y tablas al actualizar; no se ejecuta `remove` ni se aplican seeds. Cada Lambda crea su rol IAM, por lo que los laboratorios que prohíben `iam:CreateRole` no son compatibles con esta configuración sin un rol preexistente soportado por Serverless. Revisa cuidadosamente cualquier cambio de stack: los cambios de esquema/borrado manual pueden afectar datos. El primer despliegue puede generar costos.

Serverless v4 puede requerir inicio de sesión/licencia incluso para empaquetar. Los archivos declaran versión exacta `4.17.1`, pero la prueba de empaquetado de esta sesión se detuvo en el requisito de autenticación del CLI; no se generó artefacto validado. La prueba tampoco acredita permisos de AWS Academy.

El archivo `frontend/.env.production.local` se genera con endpoints/valores públicos de Cognito y está excluido de Git. Vite incorpora `VITE_*` al bundle público; nunca pongas secretos allí. Amplify no queda publicado por `serverless deploy`: conecta el repositorio a Amplify, configura `appRoot=frontend`/el build de raíz `amplify.yml`, añade las mismas variables públicas `VITE_*` desde la salida generada y configura rewrite SPA a `/index.html`. La publicación automática en Amplify depende de permisos/API disponibles en el laboratorio y requiere configurar la app/branch.

## Verificación y demo

`deploy:academy:verify` solo lee los outputs de los nueve stacks. Después de publicar Amplify, crear/provisionar usuarios de prueba en Cognito (el alta local no aprovisiona tenants AWS), comprobar APIs con un usuario de cada tenant y verificar que un ID ajeno no se lee/actualiza. Cognito por sí solo no crea tenant/membership; el flujo de provisioning de producción sigue pendiente. El preflight no puede confirmar permisos de CloudFormation/IAM de un laboratorio ni cuotas de cuenta.

## Carga académica (separada)

No es parte del despliegue. `npm run seed:full` exige `ASTRA_SEED_TARGET=aws-academy`, `--confirm-aws-academy`, `AWS_STAGE`, `AWS_REGION` y `AWS_ACCOUNT_ID`, y escribe hasta 10 000 filas por tenant/servicio (180 000 filas; tres tenants y seis tablas). Usa claves deterministas, reanuda faltantes y genera reporte verificable. Los datos de identidad son perfiles ficticios, no usuarios autenticables; tablas auxiliares/reminders no forman parte del conteo. Revisa la interpretación académica de “30 000 por microservicio” antes de ejecutarlo. No correrlo como validación de despliegue.

## Límites comprobados

- AWS Academy puede negar Cognito, Amplify, creación de roles o algunos recursos CloudFormation; no hay bypass. El instructor debe confirmar permisos y regiones.
- Budget, Resource y Priority tienen YAML Python 3.12 y `serverless-python-requirements`, pero los handlers observados son `app.py`; confirmar compatibilidad del plugin/handler y empaquetado antes de AWS. Los servicios Node configuran runtime Node 20.
- Sólo ProjectCreated→SNS→SQS→Budget tiene consumidor cloud declarado. Los demás workers/eventos son locales.
- CORS `*` y el rol/tenant inicial de Cognito requieren endurecimiento/provisioning. No asumir aislamiento cloud probado por el authorizer: probar la autorización de dominio con tokens reales.
- La ruta de documentos S3, reintentos end-to-end/outbox, permisos Academy, builds de Serverless y publicación Amplify requieren verificación real autorizada.
- El build frontend de Amplify es `npm ci` y `npm run build --workspace frontend`; no se ejecuta build durante el despliegue backend.
