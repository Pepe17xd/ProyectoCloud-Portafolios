> Inventario hist?rico; los resultados recientes y las brechas vigentes constan en [ASTRA_ORBITAL_RELEASE_REPORT.md](../ASTRA_ORBITAL_RELEASE_REPORT.md).

# Incidencias y límites conocidos

## Pendientes de aceptación

1. **Seed full no ejecutado.** En la base local solo se verificó el seed demo (360 filas). Debe ejecutarse `npm run seed:full` y conservarse el reporte de conteos; el criterio 30,000 por servicio aún no está satisfecho.
2. **Pruebas Playwright ausentes.** No hay evidencia de pruebas de UI automatizadas. Frontend compila, sirve localmente y está conectado a APIs, pero los clics/navegación de navegador no se probaron con Playwright.
3. **Integración AWS pendiente.** No se ejecutaron `serverless package` ni despliegues. No se desplegó en AWS, de acuerdo con el alcance.
4. **Cobertura parcial de autorización HTTP.** Tenant B recibió 404 para GET/PATCH/DELETE del proyecto de Tenant A; VIEWER recibió 403 al crear proyecto. Falta probar cada servicio, endpoint secundario, paginación e índices con tenants cruzados y roles completos.
5. **Mensajes fallidos y DLQ no forzados.** Se demostró `ProjectCreated` SNS→SQS→Budget y la escritura asociada; no se provocaron reintentos, duplicados ni redrive a DLQ.
6. **S3 vía API incompleto.** Put/Get se comprobó directamente contra LocalStack; la creación/uso de URL firmada por API con el navegador no se validó.
7. **Python local usa 3.11.9.** La máquina no tiene Python 3.12; el fallback local funciona y la configuración Serverless usa `python3.12`. La compatibilidad real del empaquetado Lambda no se validó.

## Requisitos previos locales

- Docker Desktop debe estar en engine Linux/WSL2.
- Node disponible (entorno validado con Node 24.13 x64).
- Para tres APIs Python y worker: Python 3.11+ con requirements instalados; el fallback automático de este equipo es 3.11.

La ejecución de esta sesión corrigió fallos previos de permisos del volumen DynamoDB, hook LocalStack, configuración del health check, imports ESM con rutas Windows, clave decimal de boto3 y consulta de sort key.

> Inventario histórico; los resultados recientes y las brechas vigentes constan en [ASTRA_ORBITAL_RELEASE_REPORT.md](../ASTRA_ORBITAL_RELEASE_REPORT.md).
