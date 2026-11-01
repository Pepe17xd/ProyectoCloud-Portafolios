import React, { useEffect, useState } from 'react';
import { ArrowRight, ChartNoAxesCombined, Eye, EyeOff, Layers, ShieldCheck, Users } from 'lucide-react';
import { Brand, FoliMascot } from '../../components/Brand';
import { localAuth } from '../../api/client';
import {
  signInWithCognito, registerCognito, confirmCognito, confirmCognitoSignIn, resendCognito,
  cognitoHasOrganization, provisionCognito, getCognitoIdToken, refreshProvisionedCognitoSession,
} from '../../auth/cognito';
import { completeConfirmedRegistration, completeRegistrationChallenge, provisionAuthenticatedRegistration } from '../../auth/registration-flow.mjs';
import { navigate } from '../../hooks/navigation';
import './auth-registration.css';

const env = import.meta.env;
const EMAIL_KEY = 'profiles.pendingEmail';
const ORG_KEY = 'profiles.pendingOrganization';
const CONFIRMED_KEY = 'profiles.registrationConfirmedEmail';
const PASSWORD_REQUIREMENTS = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,256}$/;
const LOCAL_PASSWORD_REQUIREMENTS = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/;
type Phase = 'form' | 'confirm' | 'signin' | 'challenge' | 'finish';
type BusyStep = 'register' | 'confirm' | 'signin' | 'provision' | 'refresh' | 'resend' | '';

function readableAuthError(error: unknown, phase: Phase) {
  const err = error as Error & { name?: string; stage?: string };
  if (err.name === 'ExpiredCodeException') return 'El código venció. Solicita uno nuevo para continuar.';
  if (err.name === 'CodeMismatchException') return 'El código no coincide. Revísalo e inténtalo otra vez.';
  if (err.name === 'LimitExceededException' || err.name === 'TooManyRequestsException') return 'Se alcanzó el límite de intentos. Espera unos minutos y vuelve a probar.';
  if (err.name === 'TypeError' || err.name === 'NetworkError' || /network|fetch|timeout/i.test(err.message || '')) return 'No pudimos conectar con el servicio. Comprueba tu conexión y vuelve a intentarlo.';
  if (err.stage === 'confirmation') return 'No se pudo confirmar el correo. Revisa el código o solicita uno nuevo.';
  if (err.stage === 'challenge') return 'No pudimos verificar el paso de seguridad. Comprueba el código e inténtalo otra vez.';
  if (err.stage === 'signin' || err.stage === 'challenge') {
    if (err.name === 'UserNotConfirmedException') return 'Tu correo aún no está confirmado. Vuelve al paso de verificación.';
    if (err.name === 'NotAuthorizedException') return 'No se pudo iniciar sesión. Comprueba tu contraseña e inténtalo de nuevo.';
    return 'El correo se confirmó, pero no pudimos iniciar sesión. Ingresa tu contraseña para continuar.';
  }
  if (err.stage === 'provision') return err.message || 'No se pudo preparar la organización. Puedes reintentar sin crear otra cuenta.';
  if (err.stage === 'refresh') return err.message || 'La organización está preparada, pero no pudimos actualizar tus permisos.';
  if (err.name === 'UsernameExistsException') return 'Ya existe una cuenta con este correo. Inicia sesión para continuar.';
  if (err.name === 'InvalidPasswordException') return 'Usa al menos 12 caracteres con mayúscula, minúscula, número y símbolo.';
  if (!err.stage && err.message && !/exception|stack|token|arn:|request id/i.test(err.message)) return err.message;
  return phase === 'confirm' ? 'No se pudo confirmar el correo. Revisa el código y vuelve a intentarlo.' : 'No se pudo completar este paso. Comprueba tus datos e inténtalo de nuevo.';
}

export default function AuthPage({ register = false, redirect = '/app' }: { register?: boolean; redirect?: string }) {
  const [organizationName, setOrganizationName] = useState(() => localStorage.getItem(ORG_KEY) || '');
  const [phase, setPhase] = useState<Phase>('form');
  const [busyStep, setBusyStep] = useState<BusyStep>('');
  const [code, setCode] = useState('');
  const [challengeResponse, setChallengeResponse] = useState('');
  const [challengeStep, setChallengeStep] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = busyStep !== '';
  const registrationStep = phase === 'form' ? 0 : phase === 'finish' ? 2 : 1;

  useEffect(() => {
    if (!register || localAuth) return;
    const pendingEmail = localStorage.getItem(EMAIL_KEY) || '';
    if (pendingEmail) {
      setEmail(pendingEmail);
      setPhase(localStorage.getItem(CONFIRMED_KEY) === pendingEmail ? 'signin' : 'confirm');
    }
    void getCognitoIdToken().then(async token => {
      if (!token) return;
      if (await cognitoHasOrganization()) { navigate('/app'); return; }
      setPhase('finish');
    }).catch(() => {});
  }, [register]);

  function savePendingRegistration(nextEmail: string, organization: string) {
    localStorage.setItem(EMAIL_KEY, nextEmail);
    localStorage.setItem(ORG_KEY, organization);
  }

  function clearPendingRegistration() {
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(ORG_KEY);
    localStorage.removeItem(CONFIRMED_KEY);
  }

  async function finishProvisioning() {
    setBusyStep('provision'); setError(''); setNotice('Preparando tu organización...');
    try {
      await provisionAuthenticatedRegistration({ organizationName: organizationName.trim(), provision: provisionCognito, refresh: refreshProvisionedCognitoSession, hasOrganization: cognitoHasOrganization });
      clearPendingRegistration(); setPassword(''); setConfirmPassword(''); setNotice('Entrando a ProFiles...'); navigate('/app');
    } catch (cause) { setPhase('finish'); setError(readableAuthError(cause, 'finish')); setNotice(''); }
    finally { setBusyStep(''); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    const normalizedEmail = email.trim().toLowerCase();
    setEmail(normalizedEmail);
    if (register && !localAuth) {
      if (phase === 'form') {
        if (!PASSWORD_REQUIREMENTS.test(password)) { setError('La contraseña debe tener entre 12 y 256 caracteres e incluir mayúscula, minúscula, número y símbolo.'); return; }
        if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
        if (name.trim().length < 2 || organizationName.trim().length < 2) { setError('Completa tu nombre y el nombre de la organización.'); return; }
        setBusyStep('register');
        try {
          await registerCognito(normalizedEmail, password, name.trim());
          savePendingRegistration(normalizedEmail, organizationName.trim());
          setPhase('confirm'); setNotice('Te enviamos un código. Confirma tu correo para preparar tu organización.');
          // The password stays only in component memory until the confirmation flow ends.
        } catch (cause) { setPassword(''); setConfirmPassword(''); setError(readableAuthError(cause, phase)); }
        finally { setBusyStep(''); }
        return;
      }
      if (phase === 'confirm') {
        if (!code.trim()) { setError('Escribe el código que recibiste por correo.'); return; }
        setBusyStep('confirm'); setNotice('Confirmando correo...');
        try {
          const result = await completeConfirmedRegistration({
            email: normalizedEmail, password, organizationName: organizationName.trim(), code: code.trim(),
            confirm: confirmCognito, signIn: signInWithCognito, confirmSignIn: ({ challengeResponse }) => confirmCognitoSignIn(challengeResponse),
            provision: provisionCognito, refresh: refreshProvisionedCognitoSession, hasOrganization: cognitoHasOrganization,
          });
          localStorage.setItem(CONFIRMED_KEY, normalizedEmail);
          setPassword(''); setConfirmPassword('');
          if (result.status === 'challenge') {
            setChallengeStep(result.step); setPhase('challenge'); setNotice('Tu cuenta solicita un paso adicional de seguridad. Complétalo para continuar.');
          } else {
            clearPendingRegistration(); setNotice('Entrando a ProFiles...'); navigate('/app');
          }
        } catch (cause) {
          const err = cause as Error & { stage?: string };
          if (err.stage !== 'confirmation') localStorage.setItem(CONFIRMED_KEY, normalizedEmail);
          if (err.stage === 'signin') { setPassword(''); setPhase('signin'); }
          if (err.stage === 'provision' || err.stage === 'refresh') { setPassword(''); setPhase('finish'); }
          setNotice(''); setError(readableAuthError(cause, 'confirm'));
        } finally { setBusyStep(''); }
        return;
      }
      if (phase === 'signin') {
        setBusyStep('signin'); setNotice('Iniciando sesión...');
        try {
          const result = await signInWithCognito(normalizedEmail, password);
          setPassword('');
          if (!result.isSignedIn) { setChallengeStep(result.nextStep?.signInStep || 'UNKNOWN'); setPhase('challenge'); setNotice('Tu cuenta solicita un paso adicional de seguridad.'); return; }
          await finishProvisioning();
        } catch (cause) { setNotice(''); setError(readableAuthError(cause, 'signin')); }
        finally { setBusyStep(''); }
        return;
      }
      if (phase === 'challenge') {
        setBusyStep('signin'); setNotice('Verificando el paso de seguridad...');
        try {
          const result = await completeRegistrationChallenge({ challengeResponse: challengeResponse.trim(), confirmSignIn: ({ challengeResponse }) => confirmCognitoSignIn(challengeResponse), organizationName: organizationName.trim(), provision: provisionCognito, refresh: refreshProvisionedCognitoSession, hasOrganization: cognitoHasOrganization });
          if (result.status === 'challenge') { setChallengeStep(result.step); setError('El paso no se completó. Revisa el dato e inténtalo otra vez.'); setNotice(''); return; }
          clearPendingRegistration(); setNotice('Entrando a ProFiles...'); navigate('/app');
        } catch (cause) { const err = cause as Error & { stage?: string }; if (err.stage === 'provision' || err.stage === 'refresh') setPhase('finish'); setNotice(''); setError(readableAuthError(cause, 'challenge')); }
        finally { setBusyStep(''); }
        return;
      }
      await finishProvisioning();
      return;
    }

    setBusyStep('signin');
    try {
      if (register && !LOCAL_PASSWORD_REQUIREMENTS.test(password)) throw Error('La contraseña debe tener entre 12 y 128 caracteres, con mayúscula, minúscula y número.');
      if (register && password !== confirmPassword) throw Error('Las contraseñas no coinciden.');
      if (localAuth) {
        const base = env.VITE_API_IDENTITY as string | undefined;
        if (!base) throw Error('No se configuró el servicio de identidad local.');
        const payload = register ? { organizationName, name, email: normalizedEmail, password } : { email: normalizedEmail, password };
        const response = await fetch(`${base.replace(/\/$/, '')}/auth/${register ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(result.error || (response.status === 401 ? 'Correo o contraseña incorrectos.' : `No se pudo completar la solicitud (HTTP ${response.status}).`));
        localStorage.setItem('cloudportfolio.accessToken', result.accessToken);
        localStorage.setItem('cloudportfolio.user', JSON.stringify(result.user));
      } else {
        const result = await signInWithCognito(normalizedEmail, password);
        if (!result.isSignedIn) throw Error('Tu cuenta requiere un paso adicional de seguridad.');
        if (!await cognitoHasOrganization()) { navigate('/register'); return; }
      }
      navigate(redirect.startsWith('/app') ? redirect : '/app');
    } catch (cause) { setError(readableAuthError(cause, phase)); }
    finally { setBusyStep(''); }
  }

  const canRegister = register && (localAuth || phase === 'form');
  const busyLabel = busyStep === 'register' ? 'Creando tu cuenta...' : busyStep === 'confirm' ? 'Confirmando correo...' : busyStep === 'signin' ? 'Iniciando sesión...' : busyStep === 'provision' ? 'Preparando tu organización...' : busyStep === 'refresh' ? 'Actualizando tus permisos...' : busyStep === 'resend' ? 'Enviando código...' : 'Procesando...';
  const challengeLabel = challengeStep.includes('NEW_PASSWORD') ? 'Crea una contraseña nueva' : challengeStep.includes('TOTP') ? 'Código de tu aplicación de autenticación' : 'Código de seguridad';

  return <div className="auth-page"><div className="auth-backdrop"/><div className="auth-side"><Brand light/><div className="auth-side-content"><div className="section-kicker">ProFiles · PROJECT PORTFOLIO MANAGEMENT</div><h1>{register ? 'Un espacio común para avanzar.' : 'La estrategia merece una ejecución clara.'}</h1><p>{register ? 'Crea una organización para tu equipo y conecta iniciativas, personas y decisiones.' : 'Entra a tu espacio de trabajo y continúa conectando tus iniciativas con resultados.'}</p><div className="auth-side-art"><div className="auth-art-circle circle-a"/><div className="auth-art-circle circle-b"/><div className="auth-art-card"><span><ChartNoAxesCombined size={20}/></span><b>Visión de portafolio</b><small>Personas · Proyectos · Presupuesto</small><div className="auth-art-bars"><i/><i/><i/><i/><i/><i/><i/></div></div><FoliMascot variant="avatar" className="auth-foli" alt="Foli, mascota de ProFiles"/></div></div><span className="auth-side-foot">ProFiles · Gestión de portafolios de proyectos</span></div><main className="auth-main"><a className="auth-back" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>← Volver al inicio</a><div className="auth-card"><div className="auth-mobile-brand"><Brand/></div><div className="auth-heading"><span className="section-kicker">{register ? 'NUEVA ORGANIZACIÓN' : 'BIENVENIDO DE NUEVO'}</span><h2>{register ? phase === 'form' ? 'Crea tu organización' : phase === 'confirm' ? 'Confirma tu correo' : phase === 'challenge' ? 'Verificación de seguridad' : 'Termina de preparar tu espacio' : 'Inicia sesión'}</h2><p>{register ? localAuth ? 'El entorno local creará un espacio privado y su cuenta administradora.' : phase === 'form' ? 'Confirma tu correo y prepararemos el acceso a tu organización.' : phase === 'confirm' ? `Enviamos un código a ${email || 'tu correo'}.` : phase === 'signin' ? 'Tu correo está confirmado. Inicia sesión para continuar con la configuración.' : phase === 'challenge' ? 'Completa el paso de seguridad solicitado por tu cuenta.' : 'Vamos a terminar de configurar tu organización.' : 'Ingresa con las credenciales de tu organización.'}</p></div>
      {register && !localAuth && <ol className="auth-progress" aria-label="Pasos para crear tu organización">{['Cuenta', 'Correo', 'Espacio'].map((label, index) => <li key={label} className={registrationStep === index ? 'is-current' : registrationStep > index ? 'is-complete' : ''} aria-current={registrationStep === index ? 'step' : undefined}><span>{registrationStep > index ? '✓' : index + 1}</span>{label}</li>)}</ol>}
      {register && !localAuth && phase !== 'form' ? <form onSubmit={submit}>
        {(phase === 'confirm' || phase === 'signin') && <><label htmlFor="resume-email">Correo electrónico</label><div className="auth-input"><Users size={17}/><input id="resume-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></div></>}
        {phase === 'confirm' && <><label htmlFor="confirm-code">Código de verificación</label><div className="auth-input"><ShieldCheck size={17}/><input id="confirm-code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} maxLength={20} placeholder="Código del correo"/></div><button className="auth-link-button" type="button" disabled={busy} onClick={async () => { setBusyStep('resend'); setError(''); setNotice(''); try { await resendCognito(email.trim()); setNotice('Enviamos un nuevo código a tu correo.'); } catch (cause) { setError(readableAuthError(cause, 'confirm')); } finally { setBusyStep(''); } }}>Enviar un código nuevo</button></>}
        {phase === 'signin' && <><label htmlFor="resume-password">Contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="resume-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></>}
        {phase === 'challenge' && <><p className="auth-help">{challengeStep.includes('NEW_PASSWORD') ? 'Tu cuenta requiere que establezcas una contraseña nueva.' : 'Escribe el código enviado por Cognito o generado por tu aplicación de autenticación.'}</p><label htmlFor="challenge-response">{challengeLabel}</label><div className="auth-input"><ShieldCheck size={17}/><input id="challenge-response" type={challengeStep.includes('NEW_PASSWORD') ? 'password' : 'text'} autoComplete={challengeStep.includes('NEW_PASSWORD') ? 'new-password' : 'one-time-code'} required value={challengeResponse} onChange={e => setChallengeResponse(e.target.value)} maxLength={challengeStep.includes('NEW_PASSWORD') ? 256 : 128}/></div></>}
        {(phase === 'signin' || phase === 'finish' || phase === 'challenge') && <><label htmlFor="resume-organization">Nombre de la organización</label><div className="auth-input"><Layers size={17}/><input id="resume-organization" autoComplete="organization" required minLength={2} maxLength={100} value={organizationName} onChange={e => { setOrganizationName(e.target.value); localStorage.setItem(ORG_KEY, e.target.value); }}/></div></>}
        {notice && <p className="auth-status" role="status" aria-live="polite">{notice}</p>}{error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" disabled={busy || (phase === 'confirm' && !code.trim()) || (phase === 'signin' && !password) || (phase === 'challenge' && !challengeResponse.trim())}>{busy ? <><span className="button-spinner"/>{busyLabel}</> : <>{phase === 'confirm' ? 'Confirmar y continuar' : phase === 'signin' ? 'Iniciar sesión y continuar' : phase === 'challenge' ? 'Verificar y continuar' : 'Reintentar configuración'}<ArrowRight size={17}/></>}</button>
        {phase === 'confirm' && <button className="auth-link-button" type="button" disabled={busy} onClick={() => { localStorage.setItem(CONFIRMED_KEY, email.trim().toLowerCase()); setPassword(''); setConfirmPassword(''); setPhase('signin'); setNotice('Inicia sesión para terminar la configuración.'); setError(''); }}>Ya confirmé mi correo</button>}
        {phase === 'finish' && <button className="auth-link-button" type="button" disabled={busy} onClick={() => { setPhase('signin'); setNotice('Inicia sesión para retomar la configuración.'); setError(''); }}>Iniciar sesión con otra contraseña</button>}
      </form> : <form onSubmit={submit}>
        {canRegister && <><label htmlFor="organization-name">Nombre de la organización</label><div className="auth-input"><Layers size={17}/><input id="organization-name" autoComplete="organization" required minLength={2} maxLength={100} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="Equipo de estrategia"/></div><label htmlFor="auth-name">Tu nombre</label><div className="auth-input"><Users size={17}/><input id="auth-name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido"/></div></>}
        <label htmlFor="auth-email">Correo electrónico</label><div className="auth-input"><Users size={17}/><input id="auth-email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="nombre@organizacion.com" aria-describedby={error ? 'auth-error' : undefined}/></div>
        <label htmlFor="auth-password">Contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={register && localAuth ? 128 : 256} value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? localAuth ? 'Mínimo 12 caracteres' : '12 caracteres y un símbolo' : 'Ingresa tu contraseña'} aria-describedby={error ? 'auth-error' : canRegister ? 'password-help' : undefined}/><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
        {canRegister && <><label htmlFor="auth-confirm-password">Confirma la contraseña</label><div className="auth-input"><ShieldCheck size={17}/><input id="auth-confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={localAuth ? 128 : 256} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repite la contraseña" aria-describedby="password-help"/></div><p className="auth-help" id="password-help">{localAuth ? 'Entre 12 y 128 caracteres, con mayúscula, minúscula y número.' : 'Entre 12 y 256 caracteres, con mayúscula, minúscula, número y símbolo.'}</p></>}
        {notice && <p className="auth-status" role="status" aria-live="polite">{notice}</p>}{error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" disabled={busy || !email || !password || (canRegister && (!name || !organizationName || !confirmPassword))}>{busy ? <><span className="button-spinner"/>{busyLabel || (register ? 'Creando espacio...' : 'Verificando acceso...')}</> : register ? 'Crear organización' : 'Iniciar sesión'}{!busy && <ArrowRight size={17}/>}</button>
        {!register && <p className="auth-secure"><ShieldCheck size={15}/> Conexión protegida · Acceso de tu organización</p>}
      </form>}
      <div className="auth-switch">{register ? '¿Ya tienes acceso?' : '¿Aún no tienes una cuenta?'} <a href={register ? '/login' : '/register'}>{register ? 'Iniciar sesión' : 'Crear organización'}</a></div><p className="auth-legal">{register ? 'El registro crea una organización independiente. La contraseña nunca se guarda para recuperar el proceso.' : 'Al continuar, accedes a tu espacio de trabajo de ProFiles.'}</p></div></main></div>;
}
