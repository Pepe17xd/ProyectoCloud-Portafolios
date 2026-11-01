# ProFiles v2.6

ProFiles es una aplicación SaaS para organizar portafolios, proyectos, tareas, personas, presupuestos y prioridades por organización. Incluye registro de organizaciones, control de acceso por roles, automatizaciones y Decision Lab para comparar escenarios sin alterar los datos operativos.

## Funciones

- Portafolios, proyectos, tablero de tareas, recursos, asignaciones, presupuestos y gastos.
- Dashboard con información obtenida de las APIs, reportes y reglas deterministas de seguimiento.
- Registro y acceso local o mediante Cognito; el backend aprovisiona la organización y la membresía inicial.
- Buzón interno y canal WhatsApp opcional con consentimiento, verificación, cola y webhook. La integración local usa un proveedor simulado; una cuenta Meta configurada y pruebas autorizadas son necesarias para envíos reales.

## Arquitectura

El frontend React, TypeScript y Vite consume seis servicios independientes:

| Servicio | Responsabilidad | Tecnología |
| --- | --- | --- |
| Identity | Usuarios, organizaciones, membresías, recordatorios y notificaciones | Node.js, Cognito, DynamoDB, SQS |
| Portfolio | Portafolios | Node.js, DynamoDB |
| Project | Proyectos, tareas y consultas | Node.js, DynamoDB |
| Resource | Recursos y asignaciones | Python, FastAPI, Mangum, DynamoDB |
| Budget | Presupuestos y gastos | Python, FastAPI, Mangum, DynamoDB |
| Priority | Prioridades y ranking | Python, FastAPI, Mangum, DynamoDB |

La infraestructura prevista usa API Gateway, Lambda, SNS/SQS, S3 y Amplify Hosting. El entorno local usa DynamoDB Local y LocalStack. Consulta [arquitectura](docs/ARCHITECTURE.md) y [contratos](docs/API_CONTRACTS.md).

## Ejecución local

Se necesitan Node.js 20 o superior, npm, Python, Docker y Docker Compose. Desde la raíz:

```bash
npm ci
npm run dev:local
```

Abre `http://localhost:5173`. El registro local crea una organización y un administrador; las cuentas y datos de demostración son opcionales (`npm run seed:demo`). La guía [pruebas locales](docs/LOCAL_TESTING.md) explica el entorno y sus limitaciones.

## AWS Academy

Consulta [la guía de despliegue](docs/DEPLOY_AWS_ACADEMY.md) para herramientas, credenciales temporales, LabRole, Serverless Framework v4 y permisos. Copia `.env.example` a `.env` solo si necesitas configuración local; también puedes utilizar credenciales o perfiles de AWS CLI. Nunca subas `.env` ni secretos.

```bash
npm ci
npm run deploy:academy:check
npm run deploy:academy
```

El comando obtiene IDs y URLs de los recursos durante el despliegue. Los permisos y límites varían entre laboratorios; el empaquetado completo y el despliegue en un laboratorio nuevo requieren verificación real. La carga masiva es independiente y opcional.

## WhatsApp

El canal es opcional y permanece deshabilitado sin configuración de proveedor y plantillas. Los secretos de Meta son exclusivamente del servidor. La [guía de integración](docs/WHATSAPP_INTEGRATION.md) describe consentimiento, verificación, webhook, cola, configuración y pruebas locales. La aceptación de una petición por Meta no demuestra entrega; la entrega real y el despliegue AWS no están verificados por las pruebas simuladas.

## Pruebas

```bash
npm test
npm run build --workspace frontend
npm run test:whatsapp:integration
npm run test:e2e
```

La integración WhatsApp requiere Docker, DynamoDB Local y LocalStack; ejecuta un servidor Meta simulado y no envía mensajes reales. Las pruebas de navegador requieren los servicios locales o un entorno controlado, según la prueba. Consulta `playwright.config.ts` y las guías locales.

## Limitaciones

La cobertura de pruebas locales y simuladas no demuestra que todas las operaciones CRUD, el aislamiento entre organizaciones, los eventos SNS/SQS ni las automatizaciones funcionen en AWS real. Los requisitos IAM de AWS Academy y la licencia o autenticación de Serverless Framework v4 dependen del entorno. Las dependencias y sus avisos de licencia siguen sujetos a sus propias condiciones.

## Contribuir

Abre un issue para discutir cambios significativos y envía una propuesta con descripción y pruebas. No incluyas credenciales, datos personales ni artefactos de compilación. Las contribuciones deben poder distribuirse bajo la licencia del proyecto.

## Recursos de terceros

Las imágenes históricas `frontend/public/milky-way-source.jpg`, `frontend/public/milky-way.webp` y `docs/ASTRA_MILKY_WAY_SCREENSHOT.png` contienen la fotografía [Majestic Milky Way](https://www.eso.org/public/images/milkywaylasilla-cc/). Crédito: **ESO/F. Char**; licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). La versión WebP fue comprimida y la captura histórica muestra la imagen como fondo adaptado. Estos recursos no están sujetos a la licencia MIT del código. Consulta [procedencia de activos](docs/ASSET_PROVENANCE.md) y conserva el crédito visible si los muestras o redistribuyes.

## Licencia

Este proyecto se distribuye bajo la [licencia MIT](LICENSE). Copyright (c) 2026 CloudComputin-utec2026-02. Las marcas y activos de terceros conservan sus condiciones correspondientes.

La mascota Foli y sus variantes de marca se documentan en [docs/BRAND_ASSETS.md](docs/BRAND_ASSETS.md), incluida su procedencia y el uso del isotipo SVG como fallback.
