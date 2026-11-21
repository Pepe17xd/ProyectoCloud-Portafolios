import { getCognitoIdToken } from '../auth/cognito';
import { createRequestScheduler } from './scheduler.mjs';

const env = import.meta.env;

export const localAuth = env.VITE_AUTH_MODE === 'local';

export type ApiRequest = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;

const scheduler = createRequestScheduler({ maxConcurrent: 3, retryDelayMs: 350 });

export const request: ApiRequest = async <T = any>(module: string, path: string, method = 'GET', body?: unknown): Promise<T> => {
  const token = localAuth ? localStorage.getItem('cloudportfolio.accessToken') : await getCognitoIdToken();
  if (!token) throw Error('La sesión expiró. Inicia sesión nuevamente.');

  const base = env[`VITE_API_${module.toUpperCase()}`] as string | undefined;
  if (!base) throw Error(`Falta configurar VITE_API_${module.toUpperCase()}`);

  return scheduler.schedule<T>({
    method,
    key: `${module}:${path}`,
    run: async () => {
      const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const content = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detailMsg = Array.isArray(content.detail)
          ? content.detail.map((d: any) => d.msg || `${d.loc?.join('.')}: ${d.type}`).join(', ')
          : typeof content.detail === 'string'
          ? content.detail
          : undefined;
        const msg = content.error || content.message || detailMsg || (typeof content === 'string' ? content : '') || `Solicitud fallida (HTTP ${response.status})`;
        const err = Error(msg) as Error & { status?: number; retryable?: boolean };
        err.status = response.status;
        if (response.status === 429 || response.status === 503) {
          err.retryable = true;
        }
        throw err;
      }
      return content as T;
    },
  });
};
