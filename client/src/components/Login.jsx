import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './UI';
import { apiFetch, saveAuthToken } from '../utils/api';
import { showToast } from '../utils/helpers';

export default function Login() {
  const { login } = useApp();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [fpId, setFpId] = useState('');
  const [fpOtp, setFpOtp] = useState('');
  const [fpPw, setFpPw] = useState('');
  const [fpPw2, setFpPw2] = useState('');
  const [fpStep2, setFpStep2] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);

  useEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  });

  const doLogin = async () => {
    setError('');
    if (!identity.trim() || !password) { setError('Please enter your login ID and password.'); return; }
    setLoading(true);
    try {
      await login(identity.trim(), password);
    } catch (err) {
      setError(err.message || 'Invalid credentials. Please try again.');
    } finally { setLoading(false); }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') doLogin(); };

  const sendOtp = async () => {
    if (!fpId.trim()) { showToast('Enter your login ID or email'); return; }
    setFpLoading(true);
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ identity: fpId.trim() }) });
      setFpStep2(true);
      showToast('OTP sent to your registered email');
    } catch (err) { showToast(err.message || 'Failed to send OTP'); }
    finally { setFpLoading(false); }
  };

  const resetPw = async () => {
    if (!fpOtp || !fpPw || fpPw !== fpPw2) { showToast('Check OTP and password match'); return; }
    setFpLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ identity: fpId.trim(), otp: fpOtp.trim(), newPassword: fpPw }) });
      showToast('Password reset successfully! Please log in.');
      setForgot(false); setFpStep2(false); setFpId(''); setFpOtp(''); setFpPw(''); setFpPw2('');
    } catch (err) { showToast(err.message || 'Reset failed'); }
    finally { setFpLoading(false); }
  };

  return (
    <div className="login-screen" style={{ display: 'flex', position: 'fixed', inset: 0, background: 'linear-gradient(135deg,#2d0a0a,#7f1d1d,#c0392b)', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
      <div className="login-card">
        {/* Logo */}
        <div className="text-center mb-5">
          <img src="/assets/onepws-dark-logo-scaled.png" alt="OnePWS" style={{ width: '100%', height: 84, maxWidth: 300, objectFit: 'contain', display: 'block', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Integrated Quality Audit Management Portal · AS9100D</p>
        </div>

        {/* Error */}
        {error && (
          <div className="login-error" style={{ display: 'block' }}>
            <Icon name="circle-alert" className="mr-1" /> {error}
          </div>
        )}

        {/* Fields */}
        <div className="login-field">
          <label>Login ID</label>
          <input
            id="li-u"
            placeholder="Enter login ID"
            autoComplete="username"
            value={identity}
            onChange={e => setIdentity(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="login-field">
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="li-p"
              type={showPw ? 'text' : 'password'}
              placeholder="Enter password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={onKeyDown}
              style={{ paddingRight: 42 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="Toggle password"
              onMouseDown={e => e.preventDefault()}
              onClick={() => setShowPw(p => !p)}
              style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, padding: 0 }}
            >
              <Icon name={showPw ? 'eye-off' : 'eye'} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-[10px]">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} /> Remember Me
          </label>
          <button className="btn btn-ghost btn-sm" style={{ padding: '4px 7px', fontSize: 10 }} type="button" onClick={() => setForgot(true)}>
            <Icon name="key-round" /> Forgot?
          </button>
        </div>

        <button
          className="btn btn-brand"
          style={{ width: '100%', padding: '10px', fontSize: 13 }}
          onClick={doLogin}
          disabled={loading}
        >
          {loading ? '…Signing in' : <><Icon name="log-in" /> Sign In</>}
        </button>
      </div>

      {/* Forgot Password Modal */}
      {forgot && (
        <div className="modal-bg" onClick={() => setForgot(false)}>
          <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span><Icon name="key-round" /> Reset Password</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setForgot(false)}><Icon name="x" /></button>
            </div>
            <div className="mb-2"><label className="form-label">Login ID or Email</label>
              <input placeholder="Enter your login ID or email" value={fpId} onChange={e => setFpId(e.target.value)} />
            </div>
            <button className="btn btn-primary mb-2" style={{ width: '100%' }} onClick={sendOtp} disabled={fpLoading}>
              <Icon name="mail" /> {fpLoading ? 'Sending…' : 'Send OTP'}
            </button>
            {fpStep2 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
                <div className="info-box mb-2">Enter the OTP sent to your registered email. The email contains only an OTP, no development link.</div>
                <div className="grid grid-cols-2 gap-[9px] mb-2">
                  <div><label className="form-label">OTP</label><input inputMode="numeric" maxLength={6} placeholder="6 digit OTP" value={fpOtp} onChange={e => setFpOtp(e.target.value)} /></div>
                  <div><label className="form-label">New Password</label><input type="password" placeholder="Min 6 chars" value={fpPw} onChange={e => setFpPw(e.target.value)} /></div>
                </div>
                <div className="mb-2"><label className="form-label">Confirm Password</label><input type="password" value={fpPw2} onChange={e => setFpPw2(e.target.value)} /></div>
                <button className="btn btn-brand" style={{ width: '100%' }} onClick={resetPw} disabled={fpLoading}>
                  <Icon name="shield-check" /> {fpLoading ? 'Resetting…' : 'Reset Password'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
