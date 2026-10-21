# ADR 0001: Límites de servicio y propiedad de datos

- Estado: Aceptado como arquitectura objetivo; implementación parcial.
- Fecha: 2026-10-20.

## Contexto

CloudPortfolio requiere seis dominios PPM desplegables de forma independiente y aislamiento multi-tenant. El repositorio ya contiene seis stacks con una tabla DynamoDB distinta por servicio, aunque el código comparte actualmente un CRUD genérico similar.

## Decisión

Mantener Identity, Portfolio, Project, Resource, Budget y Priority como límites de servicio. Cada dominio es propietario exclusivo de su tabla, expone operaciones mediante su API y comparte referencias externas solo por identificadores. Las reacciones entre servicios se coordinan con eventos versionados sobre SNS/SQS.

## Consecuencias

- Evitamos acceso directo a tablas de otros dominios y acoplamiento por esquema.
- Las vistas agregadas requieren APIs o proyecciones alimentadas por eventos y aceptan consistencia eventual.
- Operaciones entre dominios necesitan contratos, idempotencia y trazabilidad.
- Los límites existen en infraestructura, pero los modelos específicos y consumidores siguen incompletos.
