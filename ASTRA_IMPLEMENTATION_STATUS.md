> Instant?nea de las fases A?G previa a Orbital; consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](ASTRA_ORBITAL_RELEASE_REPORT.md) para el estado vigente.

# ASTRA — Estado de implementación

Fecha: 21 de octubre de 2026. Estado basado en inspección y verificaciones de esta sesión. No se realizó ningún despliegue AWS ni carga masiva.

## Fases y estado

| Fase | Estado | Evidencia |
|---|---|---|
| A — Diagnóstico/baseline | Completada | Baseline Node 12/12, Python 7/7 y build frontend aprobado. |
| B — Seguridad/tenant/integridad | Parcial, avanzó | RBAC compartido, referencias tenant-scoped, corrección de membership PATCH, transacciones y pruebas; quedan flujos y cobertura adicionales. |
| C — Flujos PPM | Parcial | Operaciones de APIs existentes y seed pequeño; frontend aún no integra todos los flujos. |
| D — Eventos | Parcial | ProjectCreated→Budget verificado localmente de API a SNS/SQS, consumidor y DynamoDB. DLQ/redelivery aún no se verificaron. |
| E — Experiencia ASTRA | Parcial | Landing pública, autenticación y componentes con identidad ASTRA; responsive implementado por CSS, no automatizado en dispositivos. |
| F — E2E local | Parcial | Infra local y seis servicios iniciados; login, rutas, CORS y navegación verificadas en Chrome; Playwright aún no configurado. |
| G — Serverless/Amplify | Pendiente | No se validó packaging ni despliegue. AWS no se tocó. |

## Cambios realizados

- Definida matriz RBAC común: VIEWER lectura; MANAGER lectura/alta/edición; ADMIN incluye borrado y administración Identity. Aplicada en `shared/index.mjs` y servicios Python.
- Identity ahora restringe escrituras administrativas, valida membership contra perfil del tenant y permite PATCH de role/status; rutas de tenant ocultan recursos de otros tenants.
- Agregado `assertRelatedEntity()` para validar referencias con el API propietario y el JWT del usuario. Project valida portfolio/owner; Portfolio valida owner; Resource, Budget y Priority validan Project. Fallos de dependencias cierran con 503.
- Budget expenses usan `TransactWriteItems` para actualizar gasto y presupuesto atómicamente, con clave idempotente opcional.
- Resource assignments reservan capacidad y crean asignación transaccionalmente; capacidad no puede reducirse por debajo de la asignada.
- Corregidas respuestas de Project/Portfolio para exponer IDs y listados de portfolio para omitir hijos; se ajustaron cursores de objetivos.
- Añadidos tests de matriz RBAC, referencias HTTP y pruebas Python de tenant/operaciones transaccionales.
- Preparado `scripts/seed-local.mjs` como fixture local pequeño, coherente e idempotente; separado de `scripts/seed-large-aws.mjs`, que requiere confirmación explícita AWS. No se ejecutó el seed masivo.
- Actualizado el contrato RBAC y referencias en `docs/API_CONTRACTS.md`.
- Frontend reestructurado en rutas públicas, login, registro informativo y consola protegida; landing ASTRA con datos ilustrativos explícitos y marca vectorial CSS.
- Corregidos literales mojibake en fuentes del frontend y metadatos; el charset UTF-8 se verifica con tests.
- Añadido CORS por origen configurable en Resource, Budget y Priority, necesario para que el dashboard local consulte esas APIs desde Vite.

## Pruebas y verificaciones ejecutadas

- Baseline antes de cambios: `npm test` 12/12; pytest 7/7; `npm run build --workspace frontend` aprobado.
- Última suite: `npm test` 18/18; pytest 18/18; Ruff sin hallazgos.
- Build actual frontend: `npm run build --workspace frontend` aprobado (2 186 módulos, Vite build completado).
- `npm run seed:demo` insertó/verificó 54 filas fixture en seis servicios y tres tenants. No se borraron datos existentes. No se corrió `seed:full`.
- `npm run dev:local` inició DynamoDB Local, LocalStack, seis APIs, worker Budget y frontend. Python 3.12 no está instalado localmente; se usó Python 3.11 como fallback, mientras Lambda queda declarada para 3.12.
- Navegador Chrome: landing `/`, `/login`, `/register` y rutas SPA protegidas responden; login inválido devuelve mensaje 401; login demo válido abre `/app`; logout vuelve a `/`; acceso no autenticado a `/app/projects` presenta login; registro explica que no crea cuenta.
- Dashboard interno consume APIs; al principio las preflight CORS de FastAPI devolvieron 405. Tras agregar middleware CORS, OPTIONS devolvió 200 y los seis módulos pudieron cargar datos en el dashboard.
- Prueba manual RBAC: MANAGER DELETE Project → 403; VIEWER POST Project → 403; ADMIN tenant B GET de proyecto tenant A → 404.
- Referencia negativa manual: Portfolio con ownerId ajeno → 422; Budget con projectId inexistente → 422.
- Prueba manual de evento: POST Project devolvió 201 y el servicio registró un `MessageId` SNS; se consultó por clave el item `initial-<projectId>` de Budget en `cloudportfolio-budget-local`, con `sourceEventId` presente. Esto prueba el flujo local de ProjectCreated→SNS→SQS→worker→DynamoDB.
- La base local persistente ya tenía miles de filas históricas. Se evitó hacer scans o limpiezas; no se ejecutó `docker compose down -v`.

## No ejecutado y límites

- No se ejecutó seed masivo, carga de 180 000 registros, despliegue/remoción CloudFormation ni creación de recursos AWS.
- Playwright E2E no está implementado/ejecutado. No se completaron todos los flujos CRUD integrales del frontend.
- S3 presigned upload/download, DLQ, redelivery inducida, idempotencia de consumidor mediante duplicado, Serverless packaging y Amplify no se verificaron.
- El flujo ProjectCreated no tiene outbox; existe riesgo de proyecto persistido y evento no publicado si SNS falla después del Put.
- Las referencias síncronas entre servicios requieren URLs API Gateway configuradas en AWS; permisos, timeouts y configuración real AWS Academy no están verificados.
- No se validaron tamaños móviles/tablet mediante emulación automatizada; se implementaron breakpoints responsive y `prefers-reduced-motion`.

## Próximas acciones

1. Completar pruebas locales de aislamiento para Identity, Portfolio y demás rutas; validar escritura de referencias inválidas/ajenas.
2. Verificar formularios y flujos PPM integrados (presupuesto, gasto, prioridad, tareas, asignaciones) contra APIs locales.
3. Revisar consultas/paginación Python con fixtures de prueba acotados; medir limitaciones de filtros/agregados.
4. Verificar S3 presigned URL y transferencia en LocalStack; probar redelivery y DLQ en entorno seguro.
5. Añadir Playwright para recorridos ADMIN/MANAGER/VIEWER y dos tenants, sin limpiar volúmenes existentes.
6. Aplicar identidad ASTRA y completar documentación solicitada.
7. Validar YAML, `serverless package`/offline donde sea posible y build Amplify; documentar cualquier limitación de AWS Academy.

## Riesgos restantes

- Publicación de eventos tras escritura sin outbox ni compensación.
- No existe una suite automatizada E2E frontend completa todavía.
- Listados con filtros/agregados pueden recorrer muchas páginas; con los datos históricos locales deben revisarse cargas y tiempos.
- Los seis servicios están levantados en local, pero eso no implica preparación de AWS verificada.
- La aplicación no debe presentarse como PPM E2E completo hasta cerrar las pruebas y conexiones pendientes.

## Actualización ASTRA Galaxy (21 de octubre de 2026)

- Sistema visual oscuro galáctico y landing ampliada; captura en `docs/ASTRA_GALAXY_LANDING.png`.
- `POST /intelligence/ask` es un asistente determinista, read-only y tenant-scoped que consulta APIs de dominio; no usa un LLM.
- Identity expone preferencias/notificaciones personales; un worker local procesa eventos a buzón con etiqueta “Simulado localmente — No enviado a WhatsApp”. No verifica externamente el número ni envía mensajes reales.
- Playwright instalado: 2 escenarios pasan en Chromium con login, rutas, APIs, tenant A/B, roles, eventos, notificaciones locales, S3 local y layout móvil.
- PyYAML parseó 12/12 archivos YAML tras corregir rutas/interpolaciones. No se ejecutó Serverless packaging ni Amplify real.
- `npm audit`: 0 vulnerabilidades tras actualizar Faker a 10.6.0; `npm ci --dry-run --ignore-scripts` aprobado.
- No hubo seed masivo ni despliegue. Algunos registros/objetos E2E permanecen en volúmenes locales persistentes.
- No hay metadata `.git` en el directorio; remoto/rama/staged no verificables, sin commit/push. Ver `ASTRA_GALAXY_IMPLEMENTATION_REPORT.md` para alcance y pendientes.

> Instantánea de las fases A–G previa a Orbital; consulta [ASTRA_ORBITAL_RELEASE_REPORT.md](ASTRA_ORBITAL_RELEASE_REPORT.md) para el estado vigente.
