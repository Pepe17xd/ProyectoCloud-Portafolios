import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight } from 'lucide-react';
import { localAuth } from './api/client';
import { getCurrentCognitoUser, cognitoHasOrganization } from './auth/cognito';
import { Brand } from './components/Brand';
import { navigate, usePathname } from './hooks/navigation';
import './style.css';
import './profiles-design.css';

const Landing = lazy(() => import('./features/landing/Landing'));
const AuthPage = lazy(() => import('./features/auth/AuthPage'));
const Workspace = lazy(() => import('./features/workspace/Workspace').then(module => ({ default: module.Workspace })));

function RouteLoading({ label = 'Cargando ProFiles…' }: { label?: string }) {
  return <div className="route-loading" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true"/>{label}</div>;
}

function App() {
  const rawPathname = usePathname();
  const pathname = rawPathname.replace(/\/+$/, '') || '/';
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const protectedRoute = pathname === '/app' || pathname.startsWith('/app/');
  const authRoute = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    let active = true;
    if (!protectedRoute && !authRoute) { setAuthenticated(false); return () => { active = false; }; }
    setAuthenticated(null);
    const check = async () => {
      if (localAuth) {
        const valid = Boolean(localStorage.getItem('cloudportfolio.accessToken') && localStorage.getItem('cloudportfolio.user'));
        if (active) setAuthenticated(valid);
        return;
      }
      try { await getCurrentCognitoUser(); const ready = await cognitoHasOrganization(); if (active) setAuthenticated(ready); }
      catch { if (active) setAuthenticated(false); }
    };
    void check();
    const onStorage = () => void check();
    window.addEventListener('storage', onStorage);
    return () => { active = false; window.removeEventListener('storage', onStorage); };
  }, [pathname, protectedRoute, authRoute]);

  useEffect(() => {
    if (authenticated && authRoute) navigate('/app');
    if (authenticated === false && protectedRoute) navigate('/login');
  }, [authenticated, authRoute, protectedRoute]);

  const fallback = <RouteLoading/>;
  if ((protectedRoute || authRoute) && authenticated === null) return <RouteLoading label="Verificando tu sesión…"/>;
  if (protectedRoute && !authenticated) return <Suspense fallback={fallback}><AuthPage redirect={pathname + window.location.search}/></Suspense>;
  if (authRoute && authenticated) return <RouteLoading label="Abriendo tu espacio de trabajo…"/>;
  if (pathname === '/login') return <Suspense fallback={fallback}><AuthPage/></Suspense>;
  if (pathname === '/register') return <Suspense fallback={fallback}><AuthPage register/></Suspense>;
  if (protectedRoute) return <Suspense fallback={fallback}><Workspace/></Suspense>;
  if (pathname !== '/') return <div className="not-found"><Brand/><h1>P&aacute;gina no encontrada</h1><p>Revisa la direcci&oacute;n o vuelve al inicio de ProFiles.</p><a className="landing-button primary" href="/">Ir al inicio <ArrowRight size={16}/></a></div>;
  return <Suspense fallback={fallback}><Landing/></Suspense>;
}

createRoot(document.getElementById('root')!).render(<App/>);
