import React, { useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Eye, EyeOff, Layers, ShieldCheck, Users } from 'lucide-react';
import { Brand } from '../../components/Brand';
import { localAuth } from '../../api/client';
import { signInWithCognito } from '../../auth/cognito';
import { navigate } from '../../hooks/navigation';

const env = import.meta.env;

export default function AuthPage({ register = false, redirect = '/app' }: { register?: boolean; redirect?: string }) {
  const [organizationName, setOrganizationName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (register && password !== confirmPassword) throw Error('Las contraseñas no coinciden.');
      if (register && !localAuth) throw Error('El registro de organización aún no está configurado en AWS.');
      let result: any;
      if (localAuth) {
        const base = env.VITE_API_IDENTITY as string | undefined;
        if (!base) throw Error('No se configuró el servicio de identidad local.');
        const payload = register ? { organizationName, name, email, password } : { email, password };
        const response = await fetch(`${base.replace(/\/$/, '')}/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        result = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(result.error || (response.status === 401 ? 'Correo o contraseña incorrectos.' : `No se pudo ${register ? 'crear la organización' : 'iniciar sesión'} (HTTP ${response.status}).`));
        localStorage.setItem('cloudportfolio.accessToken', result.accessToken);
        localStorage.setItem('cloudportfolio.user', JSON.stringify(result.user));
      } else {
        result = await signInWithCognito(email, password);
        if (!result.isSignedIn) throw Error(`Cognito requiere completar este paso: ${result.nextStep.signInStep}.`);
      }
      navigate(redirect.startsWith('/app') ? redirect : '/app');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la solicitud.'); }
    finally { setBusy(false); }
  }

  const canRegister = register && localAuth;
  return <div className="auth-page"><div className="auth-backdrop"/><div className="auth-side"><Brand light/><div className="auth-side-content"><div className="section-kicker">ProFiles · PROJECT PORTFOLIO MANAGEMENT</div><h1>{register ? 'Un espacio común para avanzar.' : 'La estrategia merece una ejecución clara.'}</h1><p>{register ? 'Crea una organización local para tu equipo y conecta iniciativas, personas y decisiones.' : 'Entra a tu espacio de trabajo y continúa conectando tus iniciativas con resultados.'}</p><div className="auth-side-art"><div className="auth-art-circle circle-a"/><div className="auth-art-circle circle-b"/><div className="auth-art-card"><span><ChartNoAxesCombined size={20}/></span><b>Visión de portafolio</b><small>Personas · Proyectos · Presupuesto</small><div className="auth-art-bars"><i/><i/><i/><i/><i/><i/><i/></div></div></div></div><span className="auth-side-foot">ProFiles ? Gestión de portafolios de proyectos</span></div><main className="auth-main"><a className="auth-back" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>← Volver al inicio</a><div className="auth-card"><div className="auth-mobile-brand"><Brand/></div><div className="auth-heading"><span className="section-kicker">{register ? 'NUEVA ORGANIZACIóN' : 'BIENVENIDO DE NUEVO'}</span><h2>{register ? 'Crea tu organización' : 'Inicia sesión'}</h2><p>{register ? (localAuth ? 'El entorno local creará un tenant privado y su cuenta administradora.' : 'El alta de organizaciones en AWS requiere verificación de correo y aprovisionamiento Cognito todavía no configurados.') : 'Ingresa con las credenciales de tu organización.'}</p></div>{register && !localAuth ? <div className="register-notice" role="status"><ShieldCheck size={21}/><div><b>Registro AWS pendiente de configuración</b><p>Este formulario no crea cuentas en AWS. Usa el flujo de acceso Cognito configurado por el administrador del entorno.</p></div></div> : <form onSubmit={submit}>
    {canRegister && <><label htmlFor="organization-name">Nombre de la organización</label><div className="auth-input"><Layers size={17}/><input id="organization-name" autoComplete="organization" required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="Equipo de estrategia"/></div><label htmlFor="auth-name">Tu nombre</label><div className="auth-input"><Users size={17}/><input id="auth-name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido"/></div></>}
    <label htmlFor="auth-email">Correo electrónico</label><div className="auth-input"><Users size={17}/><input id="auth-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@organizacion.com" aria-describedby={error ? 'auth-error' : undefined}/></div>
    <label htmlFor="auth-password">Contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? 'Mínimo 12 caracteres' : 'Ingresa tu contraseña'} aria-describedby={error ? 'auth-error' : canRegister ? 'password-help' : undefined}/>{<button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>}</div>
    {canRegister && <><label htmlFor="auth-confirm-password">Confirma la contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repite la contraseña" aria-describedby="password-help"/></div><p className="auth-help" id="password-help">Usa 12 a 128 caracteres con al menos una mayúscula, una minúscula y un número. La cuenta será ADMIN de la nueva organización.</p></>}
    {error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
    <button className="button button-primary auth-submit" disabled={busy || !email || !password || (canRegister && (!name || !organizationName || !confirmPassword))}>{busy ? <><span className="button-spinner"/>{register ? 'Creando espacio...' : 'Verificando acceso...'}</> : register ? 'Crear organización' : 'Iniciar sesión'}{!busy && <ArrowRight size={17}/>}</button>
    {!register && <p className="auth-secure"><ShieldCheck size={15}/> Conexión protegida ? Acceso de tu organización</p>}
  </form>}<div className="auth-switch">{register ? '\u00bfYa tienes acceso?' : '?Aún no tienes una cuenta?'} <a href={register ? '/login' : '/register'}>{register ? 'Iniciar sesión' : 'Crear organización'}</a></div><p className="auth-legal">{register ? 'El registro local crea un tenant independiente; las credenciales nunca se guardan en el navegador.' : 'Al continuar, accedes a tu espacio de trabajo de ProFiles.'}</p></div></main></div>;
}
