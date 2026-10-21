# ASTRA Orbital — reporte de release

Fecha de verificación: 21 de octubre de 2026.

## Estado ejecutivo

El checkout contiene el diseño galáctico/orbital y una primera implementación local de acciones deterministas, recordatorios, reportes CSV y notificaciones simuladas. Los servicios ya conectados pueden validarse localmente con los resultados registrados abajo. No hubo despliegue de AWS, envío real a WhatsApp ni carga masiva.

## Implementación

- Landing y dashboard con identidad galáctica, marca ASTRA y logo orbital SVG/CSS, favicon propio, animación atenuada en el dashboard y alternativa de movimiento reducido. No usa imágenes remotas; la captura de documentación es material propio.
- Intelligence conserva consultas read-only y añade interpretación local acotada para propuestas de recordatorio y creación de tarea. Toda operación de escritura exige confirmación explícita; tenant/usuario provienen del JWT; se comprueban rol y proyecto a través de la API de dominio. No se ejecutan instrucciones, SQL ni URLs arbitrarias, y no hay proveedor LLM conectado.
- Recordatorios persistidos, una vez/diario/semanal, zona horaria, listar, pausar, reanudar, cancelar, completar al vencer y registro de acciones. El poller local relee estado persistido al reiniciar y evita duplicados mediante claves idempotentes. En AWS se declara función EventBridge por minuto, aún sin empaquetar ni desplegar.
- Reportes persistidos para estado de portafolios, avance, vencimientos, uso de recursos, presupuestos, prioridades y riesgos. CSV descargable. Las consultas limitadas a 100 filas por dominio y alcances parciales se indican en el reporte; no hay paginación agregada, filtros avanzados, conversión de monedas ni PDF.
- Las entregas locales se escriben en el buzón y están etiquetadas “Simulado localmente — No enviado a WhatsApp”. WhatsApp real permanece desactivado.
- El seed AWS conserva confirmación explícita, verificación de cuenta, rechazo de endpoints locales, límite de concurrencia, reintento de batches y verificación por partición. `SEED_TOTAL_RECORDS=3000` reparte 3 000 registros (1 000 por tenant) entre seis servicios. Solo se probó el planificador; el seed no se ejecutó.

## Persistencia e integridad

Recordatorios viven en `cloudportfolio-reminders-{stage}` con GSI `DueIndex`, separados por tenant y usuario. Historial/reportes quedan en las tablas del dominio. La creación de tarea usa la API Project y transacción con marca idempotente. Los eventos pendientes de entrega y reportes tienen alcance local/limitado; no deben presentarse como consumidores AWS operativos.

## Pruebas ejecutadas

| Verificación | Resultado | Alcance |
|---|---|---|
| `npm test` | 23/23 aprobadas | UTF-8, rutas/auth, interpretación limitada, referencias autorizadas, seed-plan, JWT, RBAC, tenant y validaciones. |
| `npm run build --workspace frontend` | Aprobado | `tsc -b` y Vite; 2 186 módulos transformados. |
| `py -3.11 -m pytest services/resource-service services/budget-service services/priority-service -q` | 18 aprobadas | Pruebas de los tres servicios Python. |
| `py -3.11 -m ruff check services/resource-service services/budget-service services/priority-service tests` | Aprobado | Lint Python. |
| E2E Playwright aislado | 2/2 aprobadas en una pasada anterior | Incluyó flujo API de acciones/recordatorios/reporte, descarga CSV desde UI, scheduler local, aislamiento A/B, roles, eventos y vistas móviles. |
| Reintento `npm run test:e2e` con configuración estándar | Falló contra procesos locales previos | Servicios activos devolvieron 404 en nuevas rutas; no se reiniciaron ni modificaron. Por lo tanto ese reintento no verifica la versión actual del stack. |
| `node scripts/init-local.mjs` | Ejecutado de forma no destructiva | Inicialización idempotente; no elimina tablas, volúmenes ni datos. |

La pasada E2E exitosa se hizo con APIs y frontend de prueba en puertos separados; su resultado se conserva en el historial de trabajo, pero no debe confundirse con el reintento estándar fallido. Los tests dejan filas de prueba únicas en los volúmenes locales persistentes. No se borraron esos datos. Para una repetición independiente, iniciar el stack de la rama actual en un entorno aislado y configurar `E2E_*_API`/`E2E_BASE_URL` y endpoint DynamoDB.

## AWS Academy

Nueve archivos `serverless.yml` y `amplify.yml` se analizaron sintácticamente con YAML. Esto solo acredita parseo YAML. Serverless Framework v4 no está disponible en el entorno; no se ejecutaron `serverless print` ni `serverless package`, ni se inspeccionó el template CloudFormation generado. Amplify no se validó en AWS. No hay ARNs, IDs ni despliegues asumidos. Pendiente: verificar empaquetado Node/Python, runtime FastAPI/Mangum, variables y referencias entre stacks, rol de laboratorio, permisos API Gateway/Cognito, tablas, SNS/SQS/DLQ, S3, scheduler, Amplify y rollback. Ningún comando de despliegue o borrado cloud se ejecutó.

## Reproducibilidad

`docs/TEAM_SETUP.md` documenta clonado, dependencias, configuración local, Docker, demo pequeña, frontend y pruebas. El colaborador no necesita secretos AWS para el modo local. Usar solo valores de `.env.example` para preparar variables; no copiar credenciales personales. No usar `docker compose down -v` si se quieren conservar los datos.

## Git y publicación

Estado al crear este reporte: remoto `origin` configurado como `https://github.com/Pepe17xd/ProyectoCloud-Portafolios.git`; rama local inicial `master` sin commits; `git ls-remote --heads origin` no mostró ramas, así que el remoto estaba vacío. Se detectaron 94 archivos no ignorados para revisión. Solo existen `frontend/.env.example` y `frontend/.env.local.example`, ambos plantillas sin secretos; `.env`, `.aws`, bases de datos, cachés, `node_modules`, `dist`, reportes de seed y artefactos de prueba están ignorados.

**La publicación todavía no está verificada.** Este reporte debe actualizarse tras staging explícito, revisión del índice, commit, push normal sin force y consulta de `git ls-remote` para confirmar SHA/rama. No declarar este checkout publicado hasta completar esas operaciones.

## Límites y próximos pasos

1. Arrancar el stack actual en puertos aislados/entorno limpio y repetir Playwright; los servicios viejos activos no corresponden a las rutas nuevas.
2. Configurar Serverless v4 del lockfile/proyecto y correr `print`/`package` offline donde sea posible.
3. Revisar el GSI global `REMINDER#ACTIVE` para escala, límites de scheduler y fallos/reintentos AWS.
4. Implementar consumidor cloud SNS/SQS con DLQ operacional y observabilidad antes de alegar entrega AWS.
5. Probar generación y scheduler con reinicios, reintentos y zonas horarias en suite aislada.
6. Mantener WhatsApp y LLM apagados hasta proveedor oficial, consentimiento verificable y credenciales gestionadas en backend.
7. Publicar solo tras inspección final de staged files, secretos y tamaños.
