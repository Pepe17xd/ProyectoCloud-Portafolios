# Probar ASTRA localmente

Esta guía es para el entorno de desarrollo local. Las cuentas que aparecen aquí son ficticias, compartidas y conocidas; no se deben reutilizar en AWS, producción ni en otros sistemas.

## Requisitos

- Windows 10/11 con Git y Node.js 20 o superior (incluye npm).
- Docker Desktop con Docker Compose habilitado.
- Python 3.11 y pip para los servicios Resource, Budget y Priority.
- Chromium de Playwright solo si ejecutarás la prueba E2E.
- Al menos 4 GB de memoria disponible para Docker y puertos 4101–4106, 4566, 5173 y 8000 libres.

## Instalación y arranque

1. Abre Docker Desktop y espera a que Docker Engine indique que está ejecutándose.
2. En PowerShell, desde la raíz clonada:

```powershell
npm ci
py -3.11 -m pip install -r services/resource-service/requirements.txt
py -3.11 -m pip install -r services/budget-service/requirements.txt
py -3.11 -m pip install -r services/priority-service/requirements.txt
npm run dev:local
```

`dev:local` inicia o reutiliza DynamoDB Local y LocalStack, ejecuta `scripts/init-local.mjs` (crea recursos que falten, no vacía tablas ni volúmenes), y arranca las seis APIs, consumidores, scheduler y Vite. No requiere credenciales AWS reales.

En otra terminal de PowerShell, carga una sola vez las fixtures pequeñas:

```powershell
npm run seed:demo
```

El seed escribe como máximo 54 registros ficticios en seis tablas y tres tenants. Es idempotente: usa condiciones `attribute_not_exists`, verifica lo persistido y falla si encuentra un registro canónico distinto; no sobrescribe perfiles existentes. Ejecutarlo otra vez debe insertar cero registros. No ejecutes `npm run seed:full` en local.

URLs:

- Landing: <http://localhost:5173/>
- Login: <http://localhost:5173/login>
- Registro local: <http://localhost:5173/register>
- Aplicación: <http://localhost:5173/app>

## Cuentas demo

La contraseña compartida de las cuentas de demostración es **`Demo123!`**. El adaptador local la compara únicamente para estas identidades ficticias; no se persiste en DynamoDB. Los perfiles, memberships, proyectos y demás fixtures sí quedan en DynamoDB Local después de `seed:demo`.

| Correo | Organización / tenant | Rol | Qué permite probar |
|---|---|---|---|
| `admin-a@demo.local` | Empresa A / `tenant-a` | ADMIN | Leer y crear, editar y eliminar registros; administrar usuarios. |
| `manager-a@demo.local` | Empresa A / `tenant-a` | MANAGER | Leer, crear y editar datos de dominio; no puede eliminar ni administrar usuarios. |
| `viewer-a@demo.local` | Empresa A / `tenant-a` | VIEWER | Consultar datos; no puede crear, editar ni eliminar. |
| `admin-b@demo.local` | Empresa B / `tenant-b` | ADMIN | Administración completa dentro del tenant B. |
| `manager-b@demo.local` | Empresa B / `tenant-b` | MANAGER | Lectura, creación y edición dentro del tenant B. |
| `viewer-b@demo.local` | Empresa B / `tenant-b` | VIEWER | Lectura dentro del tenant B, sin cambios. |

Los permisos los valida cada API a partir del JWT local firmado; editar un `tenantId` en el navegador no cambia el alcance autorizado. El demo comparte una contraseña por comodidad y no es adecuado para cuentas personales.

El registro de `/register` crea una organización independiente y su primer usuario ADMIN. Usa un correo diferente de las seis cuentas reservadas para el demo, y una contraseña de 12–128 caracteres con mayúscula, minúscula y número. El aprovisionamiento de organizaciones en Cognito/AWS no está configurado; la página de registro local no se ejecuta en Lambda ni con `NODE_ENV=production`.

## Qué probar

- **Portafolios y proyectos:** listar, crear, editar y eliminar según RBAC; los fixtures incluyen un portafolio, proyecto, tareas e hito por tenant.
- **Recursos, presupuestos y prioridades:** explorar los datos de demostración y probar operaciones permitidas por el rol. La asignación y presupuesto se validan mediante sus APIs de dominio.
- **ASTRA Intelligence:** consulta determinista y de solo lectura sobre APIs autorizadas (por ejemplo, “¿Qué proyectos están atrasados?”). No es un LLM.
- **Acciones:** proponer y confirmar una tarea (ADMIN/MANAGER) o un recordatorio. Se persiste por tenant/usuario y puede listarse, pausarse, reanudarse o cancelarse. El scheduler local lo entrega al buzón simulado; nunca a WhatsApp.
- **Reportes:** generar y descargar CSV con datos de APIs reales, tenant-scoped, hasta 1 000 resultados por servicio. El informe marca truncamiento o servicios no disponibles. No existe exportación PDF ni programación periódica de reportes.
- **Notificaciones y eventos:** el buzón indica “Simulado localmente — No enviado a WhatsApp”. WhatsApp real no está conectado.
- **Aislamiento:** iniciar sesión como Empresa A y después como Empresa B; sus APIs solo devuelven filas del tenant del token.

## Persistencia y reinicios

DynamoDB Local almacena sus datos en el volumen Docker nombrado `dynamodb-data`; LocalStack usa `localstack-data`. `docker compose down` (comando `npm run local:down`) detiene y recrea contenedores, pero conserva esos volúmenes. No ejecutes `docker compose down -v`, `docker volume rm` ni borres el directorio de Docker si quieres mantener los datos.

El seed demo no se lanza automáticamente al iniciar; sus filas permanecen y no se duplican al repetir el comando. Los proyectos, perfiles y recordatorios se guardan en DynamoDB Local, no en memoria del frontend. El scheduler consulta el índice `DueIndex` en cada ciclo (15 segundos por defecto), así que al arrancar vuelve a leer recordatorios pendientes desde DynamoDB. Comprobé la recuperación con tablas locales aisladas: detuve el scheduler antes del vencimiento, lo reinicié después y verifiqué el recordatorio COMPLETED y su entrega simulada persistidos. También reinicié un proceso Identity y un Project aislados y leí de nuevo un perfil y proyecto sembrados. Finalmente reinicié los contenedores DynamoDB Local y LocalStack conservando sus volúmenes nombrados; después, el login, perfil, proyecto `project-tenant-a-001` y recordatorio programado `fac19e94-46cb-4b29-9727-89bb41d1bd79` seguían disponibles. El launcher de procesos se detuvo durante la interrupción de DynamoDB; levanté otra vez `npm run dev:local` y los datos se conservaron.

Para reiniciar las aplicaciones, pulsa **Ctrl+C** en la terminal que ejecuta `npm run dev:local`, luego vuelve a ejecutar `npm run dev:local`. Para parar también los contenedores sin borrar sus volúmenes:

```powershell
npm run local:down
# Abre/espera Docker Desktop y luego:
npm run dev:local
```

## Pruebas automatizadas

Con el stack local levantado:

```powershell
npm test
py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q
py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service tests
npm run build --workspace frontend
npx playwright install chromium
npm run test:e2e
```

Playwright usa cuentas demo y agrega registros con identificadores únicos a los volúmenes persistentes; no los elimina al finalizar. No corras pruebas E2E simultáneas contra el mismo adaptador: el límite local de intentos de autenticación es 12 por IP en 15 minutos.

## Solución de problemas en Windows/Docker

- **Docker no inicia:** abre Docker Desktop, espera el estado “Engine running” y ejecuta `docker ps`. No borres ni restablezcas volúmenes para resolver un problema de conexión.
- **Puerto ocupado:** consulta `Get-NetTCPConnection -State Listen` y detén únicamente la terminal/proceso ASTRA que identificaste. No finalices procesos por nombre de forma general.
- **Docker Desktop actualizó o recreó contenedores:** comprueba `docker volume ls`; `dynamodb-data` y `localstack-data` deben seguir presentes. `npm run dev:local` recrea recursos faltantes sin vaciar tablas.
- **Login responde 401:** verifica correo exacto y contraseña `Demo123!`; asegúrate de haber ejecutado `npm run seed:demo` y revisa que la consola use `VITE_AUTH_MODE=local`.
- **HTTP 429 en login:** se alcanzaron 12 intentos desde la misma IP en 15 minutos. Espera a que expire el límite; evita ciclos automáticos de login.
- **Pytest o Uvicorn fallan por Python:** instala Python 3.11 y las tres listas `requirements.txt` con los comandos anteriores.
- **CORS o API inaccesible:** usa `localhost` y el puerto original de cada servicio; revisa que Vite apunte a `4101`–`4106` y que los procesos estén vivos.
- **Demo con tablas vacías:** ejecuta el seed demo explícitamente. No uses el seed completo y no detengas Docker con `down -v`.
- **E2E falla tras cambiar configuración:** no ejecutes otra suite en paralelo; corrige endpoints, `LOCAL_JWT_SECRET` de los procesos locales y `NOTIFICATION_MODE=local-simulator` para que los adaptadores coincidan.

## Verificaciones realizadas

En la revisión local del 21 de octubre de 2026:

- `npm run seed:demo`: 0 filas insertadas y 54 verificadas en la repetición; el reporte de la ejecución inicial mostraba 54 inserciones.
- Login: ADMIN, MANAGER y VIEWER para Empresa A y Empresa B; cada JWT declaró el tenant/rol esperado y el endpoint de usuarios devolvió el perfil sembrado.
- Login de `viewer-b@demo.local` y su perfil sobrevivieron al reinicio de un proceso Identity. Correo demo reservado: el registro con `admin-a@demo.local` respondió 409.
- Protección de entorno: `scripts/local-api.mjs` rechazó `NODE_ENV=production`. El adaptador local no está conectado a los stacks Serverless.
- Playwright: 2/2 pasaron en 28.0 s en la ejecución final; cubrió registro local, login, proyecto/tarea, agente determinista, recordatorios de una vez y recurrentes, scheduler, CSV descargable, notificación local, aislamiento A/B, MANAGER/VIEWER, almacenamiento S3 local y responsive. Se ajustó la aserción para no depender de la primera página del buzón, que devuelve hasta 50 elementos sin cursor.
- Scheduler: una prueba con tablas temporales aisladas demostró recuperación de un recordatorio vencido tras reiniciar el proceso. Las dos tablas de prueba se eliminaron al terminar; no se borraron tablas ni volúmenes del usuario.
- Después de reiniciar los contenedores locales, el login, perfil, proyecto y recordatorio enumerados arriba continuaron leyéndose. Las pruebas E2E agregan datos con IDs nuevos a los volúmenes compartidos y no los limpian.
- `npm test`: 33/33 pasaron; `pytest`: 18/18 pasaron; Ruff: sin hallazgos; `npm run build --workspace frontend`: TypeScript y Vite completados.

En esta laptop el puerto 5173 ya estaba ocupado por otra instancia Vite. La URL prevista es 5173, pero Vite puede elegir 5174 automáticamente; revisa la URL que imprime `npm run dev:local`. Después de reiniciar Docker, si el supervisor se detiene por una desconexión temporal de DynamoDB, vuelve a ejecutar `npm run dev:local`; los volúmenes nombrados mantienen los datos.
## Límites

Estas cuentas, datos y sesiones son solo para pruebas locales. Los tokens duran una hora; vuelve a iniciar sesión al expirar. No hay proveedor LLM, envío WhatsApp, aprovisionamiento de tenants Cognito, PDF ni reportes recurrentes. AWS no es necesario ni participa en esta guía.
