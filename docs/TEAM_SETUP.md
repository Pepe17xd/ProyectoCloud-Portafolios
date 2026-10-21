# Puesta en marcha del equipo ASTRA

## Requisitos

- Windows 10/11, Node.js 20 o posterior y npm.
- Docker Desktop con Compose habilitado para los servicios locales.
- Python 3.11/3.12 y dependencias del backend Python, según `requirements.txt`.
- Git para clonar el repositorio.

## Instalación y ejecución

```powershell
git clone https://github.com/Pepe17xd/ProyectoCloud-Portafolios.git
Set-Location ProyectoCloud-Portafolios
npm ci
npx playwright install chromium
py -3.11 -m pip install -r services/resource-service/requirements.txt
py -3.11 -m pip install -r services/budget-service/requirements.txt
py -3.11 -m pip install -r services/priority-service/requirements.txt
npm run dev:local
```

`dev:local` inicia DynamoDB Local, LocalStack, seis APIs, workers y Vite. Las API locales usan credenciales ficticias de emulador y no requieren credenciales AWS. La inicialización configura tablas/recursos locales de forma idempotente; no ejecuta el seed de 30k.

Si ya había un stack abierto antes de actualizar el código, detén ese grupo con Ctrl+C en su terminal y vuelve a ejecutar `npm run dev:local`; no borres sus volúmenes. Las rutas nuevas de inteligencia/notificaciones aparecen al reiniciar los procesos Node.

Frontend: http://localhost:5173. APIs: puertos 4101–4106. Acceso demo del adaptador local: `admin-a@demo.local`, `manager-a@demo.local`, `viewer-a@demo.local`, `admin-b@demo.local` o `manager-b@demo.local`; contraseña común de demostración `Demo123!`. Son cuentas ficticias de desarrollo. No reutilizar en AWS.

El seed demo pequeño solo se ejecuta por decisión explícita con `npm run seed:demo`; este comando añade datos y no los borra. **No ejecutar `npm run seed:full` en local.** No usar `docker compose down -v` si se desean conservar las bases persistentes.

## Pruebas

```powershell
npm test
py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q
py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service tests
npm run build --workspace frontend
npm run test:e2e
```

Playwright requiere que el stack local ya esté activo. La suite añade filas de prueba con identificadores nuevos y no limpia volúmenes. Para detener el grupo lanzado por `dev:local`, usa Ctrl+C en esa terminal; para parar solo contenedores sin borrar sus volúmenes: `npm run local:down`.

## Configuración

Los endpoints de Vite se leen desde variables `VITE_API_*`; `VITE_AUTH_MODE=local` habilita el adaptador local. Las variables Cognito son solo para una configuración AWS posterior. No guardes claves personales en archivos versionados. `amplify.yml` apunta al build del workspace; la configuración Amplify real aún debe verificarse en AWS Academy.

## Solución de problemas

- Docker no responde: abre Docker Desktop y espera que el daemon indique que está listo.
- Puertos ocupados: identifica y detén solo el proceso de ASTRA correspondiente; no mates procesos por patrón general.
- Python ausente: instala Python 3.11 y dependencias; el runner local puede usarlo como fallback para el runtime Python declarado en AWS.
- Preflight/CORS: el origen local predeterminado es `http://localhost:5173`; si usas otro host/puerto, configura `CORS_ORIGIN` para los adaptadores y `VITE_API_*` para frontend.
- Datos demo antiguos: se mantienen en volúmenes persistentes. No los borres sin respaldo y autorización del equipo.
- Notificaciones: la verificación de número y el buzón son simulaciones locales, no verifican WhatsApp ni envían mensajes.

## Recordatorios, reportes y asistente

El dashboard permite proponer recordatorios con el formato explícito `Recuérdame <descripción> mañana a las HH:MM`, elegir una vez/diario/semanal, revisar y confirmar la propuesta, pausar, reanudar o cancelar. La tabla de recordatorios local usa un índice por vencimiento; el scheduler es persistente y vuelve a leer los registros tras reinicio. Las entregas del entorno local aparecen en el buzón de Identity y dicen “Simulado localmente — No enviado a WhatsApp”.

Los reportes se consultan en APIs de dominio y se guardan por tenant en Project Service; se pueden descargar en CSV. Cada reporte declara la fecha, servicios consultados y si el alcance es parcial. El límite actual es de 100 elementos por API; no se convierten monedas ni se aplican filtros personalizados.

Para código nuevo, detener el stack previo de forma normal con Ctrl+C y levantar `npm run dev:local`. El initializer crea de forma no destructiva `cloudportfolio-reminders-local` con `DueIndex` cuando todavía no existe. No borra tablas ni volúmenes. El worker `scripts/reminder-scheduler.mjs` es iniciado por `dev:local` y mantiene entregas locales. La configuración AWS declara un Lambda EventBridge por minuto, pendiente de `serverless print/package` y validación de permisos AWS Academy.

Las APIs de propuestas aceptan solo una plantilla limitada; solicitudes ambiguas devuelven `422`. Confirmación requiere `operationId` y repetir la misma operación es idempotente. Las operaciones son personales al actor autenticado; el backend deriva tenant/user del JWT.


Carga piloto AWS Academy: el seed masivo tiene una opción segura `SEED_TOTAL_RECORDS=3000`, que distribuye 1 000 registros por tenant entre los seis servicios. No ejecutarla desde este equipo sin autorización explícita para AWS Academy; requiere además `ASTRA_SEED_TARGET=aws-academy`, `--confirm-aws-academy`, `AWS_STAGE`, `AWS_REGION`, `AWS_ACCOUNT_ID` y credenciales de laboratorio permitidas. El mismo comando rechaza endpoints locales. El planificador de cantidades sí fue probado localmente, la carga AWS no.
