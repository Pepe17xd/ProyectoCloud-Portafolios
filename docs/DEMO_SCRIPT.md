# Guion de demostración local

## Preparación

1. Inicia Docker Desktop y confirma que el daemon está disponible.
2. En la raíz, ejecuta `npm install` y luego `npm run dev:local`.
3. En otra terminal ejecuta `npm run seed:demo`.
4. Abre http://localhost:5173. Para revisar las APIs usa los endpoints descritos en `docs/LOCAL_SETUP.md`.

Este entorno de autoría solo validó Compose estáticamente. El daemon Docker no estaba disponible, por lo que realiza esta preparación antes de la presentación y no presentes como observado ningún paso que no se haya ensayado.

## Secuencia de demo

1. **Tenant A:** iniciar sesión como `admin-a@demo.local` / `Demo123!`. Mostrar portafolios y proyectos de A.
2. **CRUD:** crear un portafolio con nombre `Modernización A`; recargar y comprobar persistencia. Crear un proyecto vinculado con el ID del portafolio y estado `ACTIVE`.
3. **Eventos/presupuesto:** esperar a que el worker procese `ProjectCreated` y revisar el nuevo presupuesto en Budget Service. Si no aparece, inspeccionar consola del worker y LocalStack; esta integración todavía carece de prueba automatizada.
4. **Aislamiento:** copiar el ID del proyecto de A, salir e iniciar `admin-b@demo.local` / `Demo123!`. Consultar el proyecto por ID en Project Service y mostrar 404; la lista solo debe devolver elementos de B.
5. **RBAC:** con `viewer-a@demo.local`, comprobar GET permitido y POST denegado (403). Con MANAGER crear/editar y verificar que DELETE responde 403. ADMIN puede eliminar.
6. **S3 (si el flujo ya fue validado):** pedir URL con POST `/documents`, subir el fichero con PUT, luego pedir GET `/documents/{id}` con el mismo tenant y recuperar el objeto mediante `downloadUrl`. Cambiar a tenant B y mostrar 404 para el mismo ID.
7. **Cerrar:** mencionar pendientes: tareas/Kanban, asignaciones, gastos, ranking calculado y suite E2E.

## Evidencia que conviene guardar

Registra tenant/rol, IDs, estado HTTP, filas visibles, mensaje de evento en SQS y reporte `seed-report-demo.json`. Aislamiento, entrega de eventos y S3 deben demostrarse con ejecución real ante el profesor; las pruebas unitarias actuales no sustituyen esa evidencia.
