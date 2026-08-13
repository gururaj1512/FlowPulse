'use client';

/**
 * Home Page — Login / Signup with FlowPulse Design System
 */

import { useState, useEffect } from 'react';
import { useAuthenticationStatus, useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/react';
import { useRouter } from 'next/navigation';
import Footer from '@/components/Footer';

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="spinner spinner-lg" />
        <p>Initializing session...</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="spinner spinner-lg" />
        <p>Redirecting to workspace dashboard...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div className="login-container">
        <LoginForm />
      </div>
      <Footer />
    </div>
  );
}

function LoginForm() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const { signInEmailPassword, isLoading: signInLoading, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signUpLoading, error: signUpError } = useSignUpEmailPassword();

  const isLoading = signInLoading || signUpLoading;
  const error = signInError || signUpError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSignUp) {
      await signUpEmailPassword(email, password);
    } else {
      await signInEmailPassword(email, password);
    }
  };

  const handleQuickLogin = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('password123');
  };

  return (
    <div className="glass-card login-card animate-fade-in" style={{ padding: '36px' }}>
      <div className="login-grid">
        {/* Left Column — Login Form */}
        <div>
          <div className="login-title" style={{ textAlign: 'left' }}>
            <div className="flex items-center gap-md mb-sm">
              <div className="navbar-brand-icon" style={{ width: '42px', height: '42px', fontSize: '1.4rem' }}>
                ⚡
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.6rem' }}>FLOWPULSE</h1>
                <p className="text-secondary text-xs font-mono" style={{ marginTop: '2px' }}>
                  Enterprise Multi-Tenant Platform
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="login-error">
              ⚠️ {error.message || 'Authentication failed. Please check credentials.'}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="email">EMAIL ADDRESS</label>
              <input
                id="email"
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner_a@demo.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">PASSWORD</label>
              <input
                id="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={isLoading}
              style={{ marginTop: '12px', padding: '12px' }}
            >
              {isLoading ? (
                <><div className="spinner" /> PROCESSING...</>
              ) : (
                isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN TO WORKSPACE'
              )}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              className="text-xs font-mono"
              onClick={() => setIsSignUp(!isSignUp)}
              style={{ 
                background: 'none', border: 'none', color: 'var(--text-accent)', 
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em' 
              }}
            >
              {isSignUp ? 'Already have an account? Sign In' : "Need a new workspace? Sign Up"}
            </button>
          </div>
        </div>

        {/* Right Column — Demo Workspace Credentials */}
        <div style={{ 
          padding: '20px', 
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-primary)',
          height: '100%'
        }}>
          <div className="flex items-center justify-between mb-md pb-xs" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="text-xs font-mono text-gold" style={{ fontWeight: 800 }}>⚡ DEMO CREDENTIALS</span>
            <span className="text-xs text-muted font-mono">Password: password123</span>
          </div>

          {/* Org A Users */}
          <div className="text-xs font-mono text-secondary mb-xs" style={{ fontWeight: 700 }}>
            ORG A (ACME CORP):
          </div>
          <div className="flex flex-col gap-xs text-xs mb-md">
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: 'var(--accent-gold)' }}>[Owner]:</strong> owner_a@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('owner_a@demo.com')}>FILL</button>
            </div>
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: '#818cf8' }}>[Editor]:</strong> editor_a@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('editor_a@demo.com')}>FILL</button>
            </div>
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: 'var(--text-muted)' }}>[Viewer]:</strong> viewer_a@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('viewer_a@demo.com')}>FILL</button>
            </div>
          </div>

          {/* Org B Users */}
          <div className="text-xs font-mono text-secondary mb-xs" style={{ fontWeight: 700 }}>
            ORG B (BETA INC):
          </div>
          <div className="flex flex-col gap-xs text-xs">
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: 'var(--accent-gold)' }}>[Owner]:</strong> owner_b@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('owner_b@demo.com')}>FILL</button>
            </div>
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: '#818cf8' }}>[Editor]:</strong> editor_b@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('editor_b@demo.com')}>FILL</button>
            </div>
            <div className="flex items-center justify-between p-xs" style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px' }}>
              <span><strong style={{ color: 'var(--text-muted)' }}>[Viewer]:</strong> viewer_b@demo.com</span>
              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 10px', fontSize: '0.68rem' }} onClick={() => handleQuickLogin('viewer_b@demo.com')}>FILL</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
