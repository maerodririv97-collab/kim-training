import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, api } from '../api/client';
import type { Me } from '../api/types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { firstName } from '../lib/format';
import { homeFor } from '../lib/roles';

function ErrorLine({ show }: { show: boolean }) {
  return (
    <div className={`lf-error${show ? ' show' : ''}`}>
      <Icon name="x" size={12} />
      <span>Este campo es obligatorio.</span>
    </div>
  );
}

export function LoginPage() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [panel, setPanel] = useState<'login' | 'forgot' | 'sent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState({ email: false, password: false });
  const [banner, setBanner] = useState<{ msg: string; warn: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotErr, setForgotErr] = useState(false);

  if (me) return <Navigate to={homeFor(me)} replace />;

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const errs = { email: !email.trim(), password: !password };
    setErrors(errs);
    if (errs.email || errs.password) return;
    setLoading(true);
    try {
      const profile = await api.post<Me>('/auth/login', { email: email.trim(), password, remember });
      setMe(profile);
      toast(profile.user.role === 'admin' ? 'Sesión iniciada como administrador' : `Hola, ${firstName(profile.user.name)}`);
      navigate(homeFor(profile), { replace: true });
    } catch (err) {
      const warn = err instanceof ApiError && err.code === 'inactive';
      setBanner({ msg: err instanceof Error ? err.message : 'Error inesperado', warn });
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setForgotErr(true);
      return;
    }
    try {
      await api.post('/auth/forgot', { email: forgotEmail.trim() });
      setPanel('sent');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error inesperado', 'x');
    }
  };

  const goForgot = () => {
    setForgotEmail('');
    setForgotErr(false);
    setPanel('forgot');
  };

  return (
    <div className="login-wrap">
      <div className="login-visual">
        <div className="glow glow-1" />
        <div className="glow glow-2" />
        <div className="lv-brand"><span className="lv-logo"><img src="/logo-kim.png" alt="KIM Solutions" /></span><span>Training</span></div>
        <div className="lv-msg">
          <div className="eyebrow">Bienestar · Movimiento · Comunidad</div>
          <h2>Cada clase suma a tu progreso.</h2>
          <p>Reserva, sigue tu evolución y conecta con tu estudio favorito desde un solo lugar, pensado para tu ritmo.</p>
          <div className="lv-dial">
            <div className="lv-stat"><div className="n">120+</div><div className="l">Clases semanales</div></div>
            <div className="lv-stat"><div className="n">8</div><div className="l">Disciplinas</div></div>
            <div className="lv-stat"><div className="n">4.9★</div><div className="l">Valoración</div></div>
          </div>
        </div>
        <div />
      </div>

      <div className="login-form-col">
        <div className="login-card">
          {panel === 'login' && (
            <form onSubmit={onLogin} noValidate>
              <div className="login-mobile-visual"><span className="dot" /><span>Bienestar, movimiento y progreso en un solo lugar.</span></div>
              <div className="login-logo"><img src="/logo-kim.png" alt="KIM Solutions" /><span className="brand-sub">Training</span></div>
              <h1>Bienvenido de nuevo 👋</h1>
              <p className="sub">Ingresa para gestionar tus clases y continuar con tu progreso.</p>

              {banner && (
                <div className={`lf-banner show${banner.warn ? ' warn' : ''}`}>
                  <Icon name="x" size={15} />
                  <span>{banner.msg}</span>
                </div>
              )}

              <div className="lf-field">
                <label htmlFor="loginEmail">Correo electrónico</label>
                <div className={`lf-input-wrap${errors.email ? ' has-error' : ''}`}>
                  <input id="loginEmail" type="email" placeholder="correo@ejemplo.com" autoComplete="username"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <ErrorLine show={errors.email} />
              </div>

              <div className="lf-field">
                <label htmlFor="loginPass">Contraseña</label>
                <div className={`lf-input-wrap${errors.password ? ' has-error' : ''}`}>
                  <input id="loginPass" type={showPass ? 'text' : 'password'} placeholder="••••••••" autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="toggle-eye" onClick={() => setShowPass((v) => !v)} aria-label="Mostrar contraseña">
                    <Icon name={showPass ? 'eyeOff' : 'eye'} size={17} />
                  </button>
                </div>
                <ErrorLine show={errors.password} />
              </div>

              <div className="lf-row">
                <label className="lf-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Recordarme
                </label>
                <button type="button" className="lf-link" onClick={goForgot}>¿Olvidaste tu contraseña?</button>
              </div>

              <button type="submit" className="btn btn-pulse btn-block" disabled={loading} style={{ opacity: loading ? 0.85 : 1 }}>
                {loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="spinner" />Iniciando sesión...</span>
                ) : 'Iniciar sesión'}
              </button>

            </form>
          )}

          {panel !== 'login' && (
            <div>
              <button className="back-row" onClick={() => setPanel('login')}>
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><Icon name="chevron" size={14} /></span>
                Volver al inicio de sesión
              </button>
              <div className="login-logo"><img src="/logo-kim.png" alt="KIM Solutions" /><span className="brand-sub">Training</span></div>
              {panel === 'forgot' ? (
                <form onSubmit={onForgot} noValidate>
                  <h1>Recupera tu contraseña</h1>
                  <p className="sub">Ingresa tu correo y avisaremos al estudio para que te ayude a crear una nueva contraseña.</p>
                  <div className="lf-field">
                    <label htmlFor="forgotEmail">Correo electrónico</label>
                    <div className={`lf-input-wrap${forgotErr ? ' has-error' : ''}`}>
                      <input id="forgotEmail" type="email" placeholder="correo@ejemplo.com"
                        value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
                    </div>
                    <ErrorLine show={forgotErr} />
                  </div>
                  <button type="submit" className="btn btn-pulse btn-block">Enviar solicitud</button>
                </form>
              ) : (
                <>
                  <h1>Solicitud enviada 📩</h1>
                  <p className="sub">
                    Si <strong style={{ color: 'var(--ink)' }}>{forgotEmail}</strong> tiene una cuenta, el equipo del estudio recibirá tu
                    solicitud y te contactará con una contraseña temporal.
                  </p>
                  <button className="btn btn-ghost btn-block" onClick={() => setPanel('login')}>Volver al inicio de sesión</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
