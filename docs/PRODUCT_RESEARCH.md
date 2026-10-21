# Investigación de producto

Fecha de consulta: 20 de octubre de 2026. Se revisó material público oficial. Esta sección separa hechos descritos por los proveedores de decisiones propias del MVP CloudPortfolio.

## Funcionalidades públicas verificadas

| Plataforma | Funcionalidad observada | Fuente oficial |
|---|---|---|
| monday.com | Solución de portafolio con tablero de resumen, conexión a proyectos, estado de salud, cronograma, overview, hitos y datos de presupuesto/esfuerzo. | [Portfolio solution](https://support.monday.com/hc/en-us/articles/13337066797202-The-portfolio-solution), [All Projects Dashboard](https://support.monday.com/hc/en-us/articles/23921675672466-Portfolio-management-All-Projects-Dashboard) |
| monday.com | Vistas de tablero como Table, Gantt, Timeline, Workload, Chart, Calendar y Kanban; dashboard agrega datos de tableros conectados. | [Board views](https://support.monday.com/hc/en-us/articles/360001267945-The-board-views), [Dashboards](https://support.monday.com/hc/en-us/articles/360002187819-The-Dashboards) |
| monday.com | Workload muestra asignación/carga por persona y puede consolidar varios tableros en un dashboard. | [Workload widget](https://support.monday.com/hc/en-us/articles/360010699760-The-Workload-Widget) |
| Smartsheet | Portafolios ofrecen lista central de proyectos, plantillas y dashboards con presupuesto, iniciativas y prioridad; el acceso depende de permisos. | [Portfolios overview](https://help.smartsheet.com/articles/2483673-portfolios-overview) |
| Smartsheet | Dashboards son hubs visuales de widgets para resumir KPIs y estado del proyecto, con control sobre contenido compartido. | [Dashboards](https://help.smartsheet.com/articles/2482264-overview-smartsheet-dashboards) |
| Smartsheet | Resource Management documenta asignación/reasignación, disponibilidad, agenda, tiempo y gastos, además de filtros y vistas guardadas para portafolios. | [Resource Management](https://help.smartsheet.com/resource-management), [Portfolio overview](https://help.smartsheet.com/learning-track/resource-management-project-management/project-portfolio) |
| Planview | PPM integra planificación/priorización, capacidad y recursos, presupuesto/actuales, dependencias, reporting y análisis de escenarios. | [Project Portfolio Management](https://www.planview.com/products-solutions/solutions/project-portfolio-management/) |
| Planview | La priorización usa criterios y puntuaciones para comparar valor, ajuste estratégico, retorno, riesgo, presupuesto y capacidad. | [PPM prioritization](https://www.planview.com/products-solutions/solutions/project-portfolio-management/), [Strategic Portfolio Management](https://www.planview.com/products-solutions/solutions/strategic-portfolio-management/) |

## Decisiones de diseño de CloudPortfolio

### Adoptaremos

- Jerarquía tenant → portafolio → proyecto → tareas, con propietarios y estados explícitos.
- Listados paginados y filtrables, con resumen ejecutivo de avance, salud, presupuesto y ranking.
- Planificación ligera de recursos: capacidad declarada y asignación por proyecto.
- Evaluación de proyectos basada en criterios explicables (impacto, urgencia, riesgo y alineamiento), con puntuación reproducible.
- Dashboards de lectura con KPIs, tablas y gráficos; vistas simples por función.
- Aislamiento por tenant en identidad autenticada, consultas y autorización.

Estas son decisiones de producto propias inspiradas por capacidades públicas comunes; no implican que tales pantallas estén implementadas actualmente.

### Simplificaremos para el MVP

- Una entidad de proyecto con campos comunes, en lugar de plantillas configurables por cliente.
- Kanban de tareas con conjunto pequeño de estados, en lugar de vistas personalizables completas.
- Asignaciones y capacidad como datos declarativos, sin calendario de turnos complejo ni hojas de tiempo.
- Ranking ponderado transparente, sin escenarios what-if, optimizador de cartera ni predicción automatizada.
- Dashboard con agregados básicos consultados de APIs; sin constructor libre de widgets ni informes configurables.
- Documentos privados en S3 con referencias autorizadas; sin biblioteca documental avanzada ni colaboración en tiempo real.

### Fuera del MVP

- IA generativa, forecasting predictivo, análisis de escenarios y recomendaciones automáticas.
- Dependencias cruzadas, diagramas Gantt completos, calendarios de capacidad y gestión de hojas de tiempo.
- Automatizaciones configurables, integraciones empresariales, portafolios ilimitados con gobierno avanzado.
- Facturación SaaS, planes comerciales, SSO empresarial, SCIM, auditoría normativa certificada y alta disponibilidad multi-región.

## Estado observado en este repositorio

La implementación inspeccionada contiene seis handlers JavaScript con CRUD genérico, tablas DynamoDB por servicio y un flujo SNS → SQS para `ProjectCreated` que crea un presupuesto inicial. El frontend es un formulario genérico de login/listado/creación para seis recursos. No hay Kanban de tareas, asignaciones, gastos, cálculo de ranking, dashboards agregados ni carga S3 visible en el código. Esta lista describe el checkout examinado, no capacidades futuras.
