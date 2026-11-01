import React, { useEffect, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Eye, EyeOff, Layers, ShieldCheck, Users } from 'lucide-react';
import { Brand } from '../../components/Brand';
import { localAuth } from '../../api/client';
import { signInWithCognito, registerCognito, confirmCognito, resendCognito, cognitoHasOrganization, provisionCognito, getCognitoIdToken } from '../../auth/cognito';
import { navigate } from '../../hooks/navigation';

const env = import.meta.env;

export default function AuthPage({ register = false, redirect = '/app' }: { register?: boolean; redirect?: string }) {
  const [organizationName, setOrganizationName] = useState(() => localStorage.getItem('profiles.pendingOrganization') || '');
  const [phase, setPhase] = useState<'form' | 'confirm' | 'signin' | 'finish'>('form');
  const [code, setCode] = useState('');
  useEffect(() => { if (register && !localAuth) { setEmail(localStorage.getItem('profiles.pendingEmail') || ''); if (localStorage.getItem('profiles.pendingEmail')) setPhase('confirm'); void getCognitoIdToken().then(token => { if (token) return cognitoHasOrganization().then(ready => { if (!ready) setPhase('finish'); }); }).catch(() => {}); } }, [register]);
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
      if (register && !localAuth) {
        if (phase === 'form') {
          if (password !== confirmPassword) throw Error('Las contrasenas no coinciden.');
          if (name.trim().length < 2 || organizationName.trim().length < 2) throw Error('Completa el nombre y la organizacion.');
          await registerCognito(email.trim(), password, name.trim());
          localStorage.setItem('profiles.pendingEmail', email.trim());
          localStorage.setItem('profiles.pendingOrganization', organizationName.trim());
          setPassword(''); setConfirmPassword(''); setPhase('confirm'); return;
        }
        if (phase === 'confirm') { await confirmCognito(email.trim(), code.trim()); setPhase('signin'); return; }
        if (phase === 'signin') {
          const result = await signInWithCognito(email.trim(), password);
          if (!result.isSignedIn) throw Error('No se pudo iniciar sesion.');
          setPassword(''); setPhase('finish');
        }
        await provisionCognito(organizationName.trim());
        localStorage.removeItem('profiles.pendingEmail'); localStorage.removeItem('profiles.pendingOrganization');
        navigate('/app'); return;
      }
      if (register && password !== confirmPassword) throw Error('Las contrasenas no coinciden.');
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
        if (!result.isSignedIn) throw Error('No se pudo iniciar sesion.');
        if (!await cognitoHasOrganization()) { navigate('/register'); return; }
      }
      navigate(redirect.startsWith('/app') ? redirect : '/app');
    } catch (e) { const name = e instanceof Error ? e.name : ''; setError(name === 'UsernameExistsException' ? 'La cuenta ya existe. Inicia sesion o recupera tu registro.' : name === 'CodeMismatchException' ? 'El codigo no es valido.' : name === 'ExpiredCodeException' ? 'El codigo caduco. Solicita otro.' : e instanceof Error && e.name === 'Error' ? e.message : 'No se pudo completar la solicitud. Comprueba los datos y vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }

  const canRegister = register && (localAuth || phase === 'form');
  return <div className="auth-page"><div className="auth-backdrop"/><div className="auth-side"><Brand light/><div className="auth-side-content"><div className="section-kicker">ProFiles · PROJECT PORTFOLIO MANAGEMENT</div><h1>{register ? 'Un espacio común para avanzar.' : 'La estrategia merece una ejecución clara.'}</h1><p>{register ? 'Crea una organización local para tu equipo y conecta iniciativas, personas y decisiones.' : 'Entra a tu espacio de trabajo y continúa conectando tus iniciativas con resultados.'}</p><div className="auth-side-art"><div className="auth-art-circle circle-a"/><div className="auth-art-circle circle-b"/><div className="auth-art-card"><span><ChartNoAxesCombined size={20}/></span><b>Visión de portafolio</b><small>Personas · Proyectos · Presupuesto</small><div className="auth-art-bars"><i/><i/><i/><i/><i/><i/><i/></div></div></div></div><span className="auth-side-foot">ProFiles ? Gestión de portafolios de proyectos</span></div><main className="auth-main"><a className="auth-back" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>← Volver al inicio</a><div className="auth-card"><div className="auth-mobile-brand"><Brand/></div><div className="auth-heading"><span className="section-kicker">{register ? 'NUEVA ORGANIZACIóN' : 'BIENVENIDO DE NUEVO'}</span><h2>{register ? 'Crea tu organización' : 'Inicia sesión'}</h2><p>{register ? (localAuth ? 'El entorno local creará un tenant privado y su cuenta administradora.' : 'Confirma tu correo para crear una organizacion independiente.') : 'Ingresa con las credenciales de tu organización.'}</p></div>{register && !localAuth && phase !== 'form' ? <form onSubmit={submit}><p>{phase === 'confirm' ? 'Introduce el codigo enviado a tu correo.' : phase === 'signin' ? 'Correo confirmado. Inicia sesion para terminar.' : 'Completa la organizacion para continuar.'}</p><label>Correo electronico<input type="email" required value={email} onChange={e => setEmail(e.target.value)}/></label>{phase === 'confirm' && <><label>Codigo de verificacion<input required value={code} onChange={e => setCode(e.target.value)} maxLength={20}/></label><button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await resendCognito(email.trim()); } catch { setError('No se pudo reenviar el codigo.'); } finally { setBusy(false); } }}>Reenviar codigo</button></>}{phase === 'signin' && <label>Contrasena<input type="password" required value={password} onChange={e => setPassword(e.target.value)}/></label>}{(phase === 'signin' || phase === 'finish') && <label>Organizacion<input required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)}/></label>}{error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Procesando...' : phase === 'confirm' ? 'Confirmar correo' : 'Completar registro'}</button><button type="button" onClick={() => setPhase('signin')}>Ya confirme mi correo</button></form> : <form onSubmit={submit}>
    {canRegister && <><label htmlFor="organization-name">Nombre de la organización</label><div className="auth-input"><Layers size={17}/><input id="organization-name" autoComplete="organization" required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="Equipo de estrategia"/></div><label htmlFor="auth-name">Tu nombre</label><div className="auth-input"><Users size={17}/><input id="auth-name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido"/></div></>}
    <label htmlFor="auth-email">Correo electrónico</label><div className="auth-input"><Users size={17}/><input id="auth-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@organizacion.com" aria-describedby={error ? 'auth-error' : undefined}/></div>
    <label htmlFor="auth-password">Contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? 'Mínimo 12 caracteres' : 'Ingresa tu contraseña'} aria-describedby={error ? 'auth-error' : canRegister ? 'password-help' : undefined}/>{<button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button>}</div>
    {canRegister && <><label htmlFor="auth-confirm-password">Confirma la contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repite la contraseña" aria-describedby="password-help"/></div><p className="auth-help" id="password-help">Usa 12 a 128 caracteres con al menos una mayúscula, una minúscula y un número. La cuenta será ADMIN de la nueva organización.</p></>}
    {error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
    <button className="button button-primary auth-submit" disabled={busy || !email || !password || (canRegister && (!name || !organizationName || !confirmPassword))}>{busy ? <><span className="button-spinner"/>{register ? 'Creando espacio...' : 'Verificando acceso...'}</> : register ? 'Crear organización' : 'Iniciar sesión'}{!busy && <ArrowRight size={17}/>}</button>
    {!register && <p className="auth-secure"><ShieldCheck size={15}/> Conexión protegida ? Acceso de tu organización</p>}
  </form>}<div className="auth-switch">{register ? '\u00bfYa tienes acceso?' : '?Aún no tienes una cuenta?'} <a href={register ? '/login' : '/register'}>{register ? 'Iniciar sesión' : 'Crear organización'}</a></div><p className="auth-legal">{register ? 'El registro crea una organizacion independiente; la contrasena no se guarda para recuperar el registro.' : 'Al continuar, accedes a tu espacio de trabajo de ProFiles.'}</p></div></main></div>;
}
