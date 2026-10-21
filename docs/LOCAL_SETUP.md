# Ejecución local

## Requisitos y comandos

Instala Node.js 20+, npm y Docker Desktop con Docker Compose, asegurando que el daemon esté ejecutándose. En la raíz del repo:

```powershell
npm install
npm run dev:local
```

El script inicia `infrastructure/docker-compose.yml` con espera de health checks, luego ejecuta `scripts/init-local.mjs`, inicia seis servidores HTTP locales, workers de Budget/Identity, el scheduler persistente de recordatorios y Vite. La inicialización idempotente usa tablas separadas por servicio, tabla de recordatorios con DueIndex, bucket S3 privado, tópico SNS, seis colas SQS, suscripciones y DLQ. No borra volúmenes ni inserta semillas.

| Componente | URL |
|---|---|
| Frontend | `http://localhost:5173` |
| Identity | `http://localhost:4101` |
| Portfolio | `http://localhost:4102` |
| Project | `http://localhost:4103` |
| Resource | `http://localhost:4104` |
| Budget | `http://localhost:4105` |
| Priority | `http://localhost:4106` |
| DynamoDB Local | `http://localhost:8000` |
| LocalStack | `http://localhost:4566` |

`GET /healthz` es un endpoint local sin autenticación. Las rutas de negocio requieren bearer JWT.

## Cuentas demo y login

La ruta `POST http://localhost:4101/auth/login` recibe `{ "email": "...", "password": "Demo123!" }` y devuelve un JWT local HS256 con `tenantId`, `role`, `sub`, `iat` y `exp`. Identidades: `admin-a@demo.local` (tenant-a ADMIN), `manager-a@demo.local` (tenant-a MANAGER), `viewer-a@demo.local` (tenant-a VIEWER), `admin-b@demo.local` y `manager-b@demo.local` (tenant-b) y `admin-c@demo.local` (tenant-c).

El servidor valida firma en tiempo constante, algoritmo, emisor y vencimiento. El secreto por defecto está en el código del adaptador local únicamente; para uso compartido, debe pasarse `LOCAL_JWT_SECRET` fuera de Git. API Gateway valida los JWT de Cognito en AWS.

## Datos

La carga demo pequeña solo se ejecuta de manera explícita en local:

```powershell
npm run seed:demo
```

`seed:demo` añade pocas filas a DynamoDB Local y no borra datos. El seed académico `scripts/seed-large-aws.mjs` está protegido: requiere `ASTRA_SEED_TARGET=aws-academy`, `--confirm-aws-academy`, cuenta/etapa/región configuradas y bloquea endpoints locales. **No ejecutar ninguna carga AWS sin autorización expresa para AWS Academy.** `RECORDS_PER_TENANT` es por servicio y tenant; el valor predeterminado produciría 180 000 registros. Para un piloto de exactamente 3 000 registros totales, `SEED_TOTAL_RECORDS=3000` distribuye el volumen entre los 18 pares servicio/tenant (1 000 por tenant) y genera un reporte de cantidades. Esta modalidad se validó solo en el planificador puro; no se ejecutó contra AWS.

## Cierre y persistencia

Ctrl+C termina los procesos Node/Vite. `npm run local:down` apaga contenedores y conserva los volúmenes. No borres volúmenes para detener el sistema. `scripts/local-infra.ps1` y `.sh` son alternativas con AWS CLI, pero `scripts/init-local.mjs` es el inicializador usado por el comando principal.

## Limitaciones verificadas en el entorno de autoría

La limitación que sigue sin verificarse es el empaquetado/despliegue de Serverless y la ejecución en AWS Academy. El stack local de referencia sí fue usado en pruebas de API/E2E, pero una instalación limpia en una segunda laptop todavía depende de Docker Desktop y no fue validada en otro equipo.
