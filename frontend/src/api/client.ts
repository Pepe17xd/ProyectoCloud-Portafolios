import { getCognitoIdToken } from '../auth/cognito';

const env = import.meta.env;

export const localAuth = env.VITE_AUTH_MODE === 'local';

export type ApiRequest = <T = any>(module: string, path: string, method?: string, body?: unknown) => Promise<T>;

export const request: ApiRequest = async <T = any>(module: string, path: string, method = 'GET', body?: unknown): Promise<T> => {
  const token = localAuth ? localStorage.getItem('cloudportfolio.accessToken') : await getCognitoIdToken();
  if (!token) throw Error('La sesión expiró. Inicia sesión nuevamente.');

  const base = env[`VITE_API_${module.toUpperCase()}`] as string | undefined;
  if (!base) throw Error(`Falta configurar VITE_API_${module.toUpperCase()}`);

  const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(content.error || `Solicitud fallida (HTTP ${response.status})`);
  return content as T;
};
