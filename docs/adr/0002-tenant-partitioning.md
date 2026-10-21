# ADR 0002: Partición por tenant en DynamoDB

- Estado: Aceptado; validación de seguridad pendiente.
- Fecha: 2026-10-20.

## Contexto

El producto debe alojar varias organizaciones y evitar filtración entre ellas. El código compartido actual deriva `tenantId` de los claims del JWT y usa `TENANT#<tenantId>` como clave de partición.

## Decisión

Cada tabla mantiene clave compuesta tenant-first (`pk = TENANT#<tenantId>`, `sk = ITEM#<id>`). Los handlers obtienen tenant del contexto de authorizer. Los endpoints no pueden seleccionar tenant mediante body/query/path para decidir autorización. Validar IDs relacionados dentro de la misma partición.

## Consecuencias

- Listas pueden consultar partición de tenant sin Scan y Get usa la clave compuesta.
- Los índices futuros deben incluir tenant en sus claves de partición.
- El aislamiento todavía requiere pruebas negativas entre tenants, validación de roles y endurecimiento de cursores.
