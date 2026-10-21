# ASTRA · frontend

Aplicación React 19 + TypeScript + Vite para la experiencia pública y el espacio de trabajo de ASTRA.

## Rutas

- `/`: landing pública con contenido de demostración estático e identificado como ilustrativo.
- `/login`: acceso local mediante `POST /auth/login` de Identity o acceso Cognito cuando está configurado.
- `/register`: con `VITE_AUTH_MODE=local`, crea en forma transaccional una organización de demostración y el usuario ADMIN inicial. En AWS muestra que el aprovisionamiento Cognito todavía está pendiente y no crea cuentas.
- `/app` y `/app/{portfolios,projects,resources,budgets,priorities}`: rutas protegidas por la sesión local o Cognito.

La navegación interna conserva el path de la sección. El backend mantiene la autoridad sobre tenant y permisos; la interfaz no ofrece un selector que permita cambiar `tenantId`.

## Desarrollo y build

Desde la raíz del monorepo:

```powershell
npm run dev:local
npm run build --workspace frontend
```

Los endpoints y el modo de autenticación se configuran con `VITE_API_*`, `VITE_AUTH_MODE` y los parámetros Cognito `VITE_COGNITO_*`, definidos en `.env.example` y `.env.local.example`. No se guardan credenciales productivas en el frontend.

Todos los fuentes se guardan en UTF-8. `index.html` declara `UTF-8`; `npm test` incluye una comprobación de bytes UTF-8, charset, textos españoles y presencia de rutas públicas.

El dashboard ilustrativo de la landing es HTML/CSS estático, etiquetado como datos ilustrativos. Las pantallas privadas siguen llamando a los servicios API existentes.
