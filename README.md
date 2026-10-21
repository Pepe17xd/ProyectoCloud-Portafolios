# ASTRA — Project Portfolio Management

ASTRA es una plataforma SaaS académica para conectar portafolios, proyectos, recursos, presupuestos y prioridades. El repositorio conserva el nombre técnico `cloudportfolio` para mantener compatibilidad con workspaces, servicios y recursos existentes.

## Inicio local

Requisitos: Node.js 20+, npm y Docker Desktop con Compose.

```powershell
npm ci
npm run dev:local
```

La interfaz se sirve en `http://localhost:5173`; los seis servicios API usan los puertos 4101–4106. El entorno local usa DynamoDB Local y LocalStack. No requiere credenciales AWS reales.

Para cargar las fixtures de demostración pequeñas, ejecuta explícitamente `npm run seed:demo`. No ejecutes procesos de carga académica masiva en el entorno local.

## Probar ASTRA localmente

Arranca Docker Desktop, ejecuta `npm run dev:local` y en otra terminal corre `npm run seed:demo` una vez. Landing: <http://localhost:5173/> · login: <http://localhost:5173/login> · registro: <http://localhost:5173/register>.

| Cuenta | Tenant | Rol | Contraseña |
|---|---|---|---|
| `admin-a@demo.local` | Empresa A | ADMIN | `Demo123!` |
| `manager-a@demo.local` | Empresa A | MANAGER | `Demo123!` |
| `viewer-a@demo.local` | Empresa A | VIEWER | `Demo123!` |
| `admin-b@demo.local` | Empresa B | ADMIN | `Demo123!` |
| `manager-b@demo.local` | Empresa B | MANAGER | `Demo123!` |
| `viewer-b@demo.local` | Empresa B | VIEWER | `Demo123!` |

Estas cuentas son ficticias y solo para el adaptador local. Pasos, capacidades por rol, persistencia y diagnóstico: [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md).

## Experiencia web

- `/`: presentación pública ASTRA.
- `/login`: autenticación local o Cognito configurado.
- `/register`: crea una organización local aislada y su usuario ADMIN inicial cuando `VITE_AUTH_MODE=local`; AWS todavía requiere un flujo de aprovisionamiento con Cognito.
- `/app` y `/app/portfolios`, `/app/projects`, `/app/resources`, `/app/budgets`, `/app/priorities`: consola protegida.

La vista previa de la landing está identificada como demostración y no consulta datos de tenants. El dashboard interno consume las APIs.

Consulta [frontend/README.md](frontend/README.md) para la configuración del frontend y [ASTRA_FRONTEND_REPORT.md](ASTRA_FRONTEND_REPORT.md) para los cambios, pruebas y límites de esta actualización.

La landing usa una fotografía local de la Vía Láctea de ESO/F. Char con crédito visible y atribución CC BY 4.0. La guía de fuente y adaptación está en [docs/ASTRA_MILKY_WAY_ASSET.md](docs/ASTRA_MILKY_WAY_ASSET.md). El registro de organizaciones funciona únicamente con el adaptador local; no está conectado al aprovisionamiento AWS Cognito.

## Stack

- React 19, TypeScript y Vite.
- Seis microservicios Node.js/Python con API Gateway/Lambda previstos para AWS.
- DynamoDB por servicio, SNS/SQS, S3 y adaptadores locales.
- AWS Amplify como destino previsto del frontend.

## Verificaciones

```powershell
npm test
py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q
npm run build --workspace frontend
```

La configuración AWS no debe considerarse desplegada por estar declarada. Consulta `docs/AWS_DEPLOYMENT.md` y `ASTRA_IMPLEMENTATION_STATUS.md` para el estado comprobado.

## ASTRA Galaxy: inteligencia y alertas locales

El dashboard incluye Inteligencia ASTRA determinista (consultas de solo lectura), acciones confirmadas para crear recordatorios o tareas y reportes CSV guardados por tenant. La propuesta usa patrones limitados, muestra una vista previa y exige confirmación. El scheduler local persiste recordatorios una vez/diarios/semanales y entrega en el buzón **“Simulado localmente — No enviado a WhatsApp”**. No hay LLM ni mensajes externos reales; la verificación local de teléfono no acredita posesión.

```powershell
# Tras levantar el stack local. Es una inicialización idempotente de recursos,
# no carga registros y no borra volúmenes.
node scripts/init-local.mjs
npm run test:e2e
```

Playwright requiere el stack local ejecutándose (`npm run dev:local`), que inicia APIs, consumidores SNS/SQS y scheduler. La suite crea pocos registros identificados y actualiza solo un recordatorio propio de prueba para forzar vencimiento; no borra filas ni volúmenes. Consulta `docs/TEAM_SETUP.md`, `docs/ASTRA_GALACTIC_ARCHITECTURE.md`, `docs/API_GALAXY_CONTRACTS.md` y `docs/EVENTS.md`.

## Recordatorios, acciones y reportes Orbital

El dashboard incluye propuestas deterministas de recordatorio, confirmación explícita, recurrencia una vez/diaria/semanal, pausa/reanudación/cancelación e historial. La API persiste recordatorios por tenant/usuario; `reminder-scheduler.mjs` consulta el índice de vencimientos y entrega en el buzón local con etiqueta de simulación. Los reportes de estado, avance, vencimientos, recursos, presupuestos, prioridades y riesgos consultan APIs reales; se persisten y se exportan a CSV. Se recorren hasta 10 páginas de 100 elementos por servicio (máximo 1 000); el reporte marca si queda truncado. No hay filtros personalizados ni PDF.

Reinicia los procesos después de cambios, ejecuta `node scripts/init-local.mjs` para crear la tabla nueva de recordatorios si no existía y después `npm run dev:local`. Esta inicialización local no borra registros ni corre seeds.

Consulta `docs/API_GALAXY_CONTRACTS.md` para los formatos exactos. AWS declara una tabla/index y un scheduler EventBridge, pero no se ha validado Serverless packaging ni desplegado en AWS Academy. WhatsApp permanece deshabilitado; ninguna entrega sale del buzón local.

Consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](ASTRA_ORBITAL_RELEASE_REPORT.md) para cambios, evidencia de pruebas, límites actuales y estado de publicación.
