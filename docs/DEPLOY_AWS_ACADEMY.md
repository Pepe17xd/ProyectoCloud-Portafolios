# Despliegue en AWS Academy

Este procedimiento crea y actualiza recursos AWS y puede consumir el presupuesto del laboratorio. La lógica se ha probado con AWS simulado; todavía no se ha validado el despliegue completo en un laboratorio nuevo. No use una cuenta anterior sin autorización.

## Requisitos

Node 20 o superior, npm, Python, AWS CLI v2, Docker Desktop en ejecución con contenedores Linux amd64 y acceso a Internet. Serverless Framework v4 puede requerir autenticación o licencia según sus condiciones. Inicie un laboratorio nuevo y configure las credenciales temporales (access key, secret key y session token) con el mecanismo proporcionado por Academy. Renueve las tres cuando caduquen; nunca las guarde en el repositorio. Configure la región y, para evitar seleccionar otra cuenta, `AWS_ACADEMY_ALLOWED_ACCOUNT` con el número de cuenta esperado. El rol por defecto es `arn:aws:iam::<cuenta>:role/LabRole`; `LAB_ROLE_ARN` permite elegir otro rol existente en esa misma cuenta. El rol debe confiar en Lambda y permitir los accesos de ejecución requeridos. El usuario de despliegue necesita `iam:GetRole` y `iam:PassRole` para ese rol.

Desde la raíz:

```bash
npm ci
npm test
npm run deploy:academy:check
npm run deploy:academy
```

En PowerShell, si la política impide ejecutar `npm.ps1`, use `npm.cmd`. Defina `AWS_REGION` antes de ejecutar los comandos; opcionalmente `AWS_STAGE` (por defecto `academy`), `AMPLIFY_APP_NAME`, `AMPLIFY_BRANCH` y `CORS_ORIGIN`. `check` consulta STS e IAM, sin crear recursos; no demuestra que todas las acciones estén autorizadas. El despliegue crea o actualiza nueve stacks, consulta sus outputs, compila Vite y publica un ZIP con `index.html` en la raíz. Reutiliza la aplicación Amplify por nombre y la rama; si existen aplicaciones con nombres duplicados se detiene. El comando nunca necesita IDs de Cognito ni URLs de API preexistentes. El modo `verify` actualmente solo ejecuta el preflight de lectura; no es una prueba integral posterior al despliegue.

## Permisos y límites

Además de STS e IAM, el usuario necesita permisos de CloudFormation, S3 para los artefactos y almacenamiento, Lambda, API Gateway, Cognito, DynamoDB, SNS, SQS, EventBridge/CloudWatch Logs y Amplify Hosting para crear, consultar y actualizar los recursos descritos en los templates. Las políticas efectivas, límites de permisos, restricciones de región y cuotas varían entre laboratorios; no se puede garantizar que `LabRole` cubra todas las operaciones. No se crean roles de ejecución IAM adicionales en este modo. El preflight comprueba que el rol existe en la cuenta, pero no simula todas sus políticas ni demuestra sus permisos efectivos.

El valor predeterminado de CORS es `*`; establezca `CORS_ORIGIN` a un origen explícito si se requiere restringirlo, y actualícelo cuando conozca el dominio Amplify. El despliegue no crea usuarios; el registro usa Cognito. `npm run seed:full` es separado y no se ejecuta automáticamente.

## Verificación pendiente en AWS

Compruebe el estado del job Amplify y sus rutas `/login/`, `/register/` y `/app`, salud de las APIs disponibles, rechazo sin JWT, CRUD autenticado, aislamiento entre dos tenants incluso por ID ajeno, SNS/SQS y sus consumidores. Verifique que los ZIP Python contienen `jwt` y `cryptography` compatibles con Lambda Python 3.12 x86_64. Las pruebas locales con mocks no demuestran permisos reales, publicación, aislamiento ni entrega de eventos. Ninguna credencial, JWT o URL de carga temporal debe copiarse a logs o archivos versionados.


## Registro Cognito

El formulario usa SignUp y confirmacion de correo. Tras iniciar sesion, Identity recibe un ID token validado por API Gateway en POST /auth/provision y crea un tenant nuevo, perfil y membresia ADMIN en una transaccion. El tenant se deriva del sub autenticado; el navegador solo envia el nombre de la organizacion. Un marcador transaccional permite repetir la operacion si falla Cognito. La sesion debe refrescarse para obtener los atributos nuevos. Se guardan temporalmente correo y nombre de organizacion en el navegador para recuperar el proceso, no la contrasena. En un dispositivo nuevo se puede iniciar sesion y proporcionar de nuevo el nombre de organizacion.

El rol de ejecucion LabRole debe permitir dynamodb:TransactWriteItems y cognito-idp:AdminGetUser y cognito-idp:AdminUpdateUserAttributes sobre el User Pool; el orquestador no agrega permisos a LabRole. Limite estos permisos y configure cuotas, proteccion contra abuso y monitoreo segun las opciones disponibles en Academy. La confirmacion por correo, autorizador, permisos de Cognito y recuperacion de fallos requieren pruebas reales en un laboratorio nuevo.

## Preparacion en una EC2 Ubuntu

Instale Node.js 20 o superior, npm, Python 3 (`python3` en PATH), AWS CLI v2 y Docker con el daemon Linux accesible al usuario; los paquetes Python se construyen para Lambda x86_64. Asegure acceso a Internet y que Serverless Framework v4 tenga la autenticacion o licencia que corresponda. Desde el repositorio clonado:

```bash
cp .env.example .env
chmod 600 .env
# Edite .env con su editor y establezca la region y, si no usa perfil o rol de instancia,
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY y AWS_SESSION_TOKEN del laboratorio.
npm ci
npm test
npm run deploy:academy:check
npm run deploy:academy
```

Al iniciar el laboratorio, obtenga las tres credenciales temporales desde la vista de credenciales AWS del curso; su ubicacion depende de la interfaz de Academy. Tambien puede dejar las tres lineas vacias y usar un perfil configurado de AWS CLI (`AWS_PROFILE`) o el rol de instancia. No mezcle una clave de una sesion con el token de otra. El archivo `.env` esta ignorado por Git; no lo comparta ni lo imprima. Las variables ya presentes en el entorno tienen prioridad sobre `.env`, y las lineas vacias no sustituyen variables existentes. El cargador acepta entradas KEY=valor, comillas simples o dobles, comentarios de linea y solo las claves de `.env.example`; no realiza interpolacion de variables.

El preflight muestra la cuenta obtenida mediante STS y comprueba que el rol existe. Para consultar STS y el rol directamente con las credenciales ya configuradas en AWS CLI o el entorno:

```bash
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
aws iam get-role --role-name LabRole --query 'Role.Arn' --output text
```

Si las credenciales estan solo en `.env`, el preflight las carga automaticamente. Los comandos AWS anteriores necesitan esas mismas credenciales exportadas o un perfil configurado; no imprima el archivo para cargarlas. Opcionalmente fije `AWS_ACADEMY_ALLOWED_ACCOUNT` para rechazar otra cuenta y `LAB_ROLE_ARN` para un rol existente diferente. Si se omiten, se usa la cuenta de STS y `LabRole` de esa cuenta. El rol y sus permisos no se crean ni modifican automaticamente.

Al terminar correctamente, el orquestador imprime las seis URLs de API y la URL publica Amplify. La aplicacion y rama se buscan por nombre para reutilizarlas; los stacks se actualizan mediante Serverless. Cuando caduque el laboratorio, reemplace juntas las tres credenciales en `.env` o actualice el perfil y vuelva a ejecutar el preflight. La instalacion y el despliegue reales, el contenido de los ZIP Python y los permisos efectivos de LabRole siguen pendientes de verificarse en AWS Academy; una sesion o licencia Serverless puede ser necesaria antes de empaquetar.

## Autenticacion de Serverless Framework v4

El CLI v4 requiere autenticacion aunque las credenciales AWS ya funcionen. En una EC2 interactiva, ejecute `npx --no-install serverless login` y complete el acceso al Dashboard mediante el navegador siguiendo las indicaciones del CLI. Para una EC2 sin navegador, configure `SERVERLESS_ACCESS_KEY` en el entorno mediante el canal seguro de su organizacion; esa clave se crea en el Dashboard y no es una credencial AWS. Alternativamente, si dispone de una suscripcion que incluya una clave de licencia, configure `SERVERLESS_LICENSE_KEY` en el entorno. Mantenga ambas claves fuera del repositorio y de los logs. La elegibilidad y los costos dependen de las condiciones vigentes del proveedor. Consulte https://www.serverless.com/framework/docs/guides/upgrading-v4 y https://www.serverless.com/framework/docs/guides/license-keys.

## Auditoria npm

El 31 de octubre de 2026 `npm audit fix` actualizo Vite dentro de su rango compatible a 6.4.5 y elimino su aviso moderado. Quedan seis entradas moderadas: `glob`, `minimatch`, `glob-all`, `rimraf`, `serverless` y `serverless-python-requirements`. Son cadenas de herramientas de desarrollo; los avisos directos afectan cancelacion de recorrido de archivos en glob (GHSA-3g3m-2fjr-6pw4) y posible denegacion de servicio en minimatch (GHSA-g3hv-75wg-m249). El informe de npm propone cambiar `serverless-python-requirements` a 3.1.0, cambio mayor que no se ha validado con Python 3.12 ni este proyecto. El paquete `serverless` esta fijado en 4.17.1 para coincidir con la version de los templates; npm indica 4.46.0 como alternativa, pero la migracion del empaquetador requiere pruebas reales antes de cambiar esa version. No se aplico `npm audit fix --force`. Evite ejecutar patrones glob no confiables durante el empaquetado y revise el informe de nuevo antes de distribuir.

El plugin 6.1.2 construye por defecto el nombre de imagen SAM a partir del runtime y la arquitectura (`public.ecr.aws/sam/build-python3.12:latest-x86_64` con los valores actuales). `dockerizePip` y `PyJWT[crypto]` estan declarados en los tres servicios. Esto confirma la configuracion prevista, no el contenido de los artefactos: falta empaquetar y revisar los ZIP en un entorno con Serverless autenticado y Docker.

## WhatsApp Cloud API: preparacion local, envios deshabilitados

El adaptador local `meta-whatsapp.mjs` construye solicitudes de plantilla para Graph API y valida la firma HMAC de bytes originales. **No esta conectado a las automatizaciones ni a un endpoint webhook y no habilita envios.** La verificacion del modo local es una simulacion y nunca acredita posesion real del numero. El estado actual no cumple aun el flujo de WhatsApp real.

Para completar la integracion hacen falta una cuenta Meta Business, WABA, telefono remitente registrado (Phone Number ID), version Graph soportada, token con permisos `whatsapp_business_messaging`, secreto de aplicacion para firmas, verify token, plantillas aprobadas y consentimiento verificable. Todos los secretos deben obtenerse en el servidor desde un almacen apropiado; nunca se ponen en variables VITE, en el repositorio ni en archivos de despliegue. Academy puede no autorizar Secrets Manager: con permisos insuficientes el canal debe continuar deshabilitado.

Antes de habilitarlo quedan pendientes una verificacion independiente de posesion, almacenamiento atomico e idempotente por tenant/usuario, limites de envio, relectura del consentimiento antes de enviar, una cola segura, webhook publico que valide firma sobre el cuerpo original, correlacion de estados por mensaje y opt-out. Una respuesta aceptada de Meta no prueba entrega. La confirmacion de un resultado ambiguo no debe reintentarse ciegamente porque podria duplicar mensajes. No se han enviado mensajes reales ni verificado estas interacciones con Meta.

## Estado funcional actual (revisión de flujos locales)

| Flujo | Estado comprobado | Límite |
|---|---|---|
| Portafolios y proyectos | API conectada; altas, edición y eliminación existentes desde Workspace | Prueba local requiere DynamoDB Local y autenticación local |
| Tareas | API conectada; nueva tarea ahora admite fecha, responsable e idempotencia generada por el cliente; estado se actualiza por API | No se ejecutó recorrido end-to-end contra DynamoDB Local en este entorno |
| Presupuestos y gastos | Formularios y APIs conectados | No implica conversión monetaria |
| Automatizaciones | Persistencia, scheduler local y ejecución existentes | Entregas siguen simuladas; no usar modo manual como tarea programada |
| Buzón interno | Funciona en modo local, persistido en DynamoDB | Entrega externa no demostrada |
| WhatsApp | Endpoints, cola, consumidor y webhook implementados; circuito local probado con emuladores y proveedor simulado | AWS y Meta reales requieren despliegue, permisos, plantillas aprobadas y prueba autorizada |
| Importación | Hay generación/descarga de reportes CSV | No existe importador Excel/CSV y no se anuncia como función |

Para habilitar WhatsApp real se requieren un proveedor Meta configurado, plantillas aprobadas, credenciales en Secrets Manager, permisos de LabRole y verificación autorizada. El recorrido local no prueba su funcionamiento real. Consulta [WHATSAPP_INTEGRATION.md](WHATSAPP_INTEGRATION.md).
