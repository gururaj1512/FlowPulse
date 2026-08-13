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
      <div className="login-title">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <div className="navbar-brand-icon" style={{ width: '48px', height: '48px', fontSize: '1.6rem' }}>
            ⚡
          </div>
        </div>
        <h1>FLOWPULSE</h1>
        <p className="text-secondary text-sm">Enterprise Multi-Tenant Workflow Platform</p>
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
          style={{ marginTop: '8px', padding: '12px' }}
        >
          {isLoading ? (
            <><div className="spinner" /> PROCESSING...</>
          ) : (
            isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN TO WORKSPACE'
          )}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: '24px' }}>
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

      {/* Demo Credentials Helper Cards */}
      <div style={{ 
        marginTop: '32px', padding: '16px', 
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-primary)'
      }}>
        <div className="flex items-center justify-between mb-sm">
          <span className="text-xs font-mono text-gold" style={{ fontWeight: 800 }}>DEMO CREDENTIALS</span>
          <span className="text-xs text-muted font-mono">Password: password123</span>
        </div>

        <div className="flex flex-col gap-xs text-xs" style={{ marginTop: '10px' }}>
          <div className="flex items-center justify-between p-sm" style={{ background: 'var(--bg-primary)', borderRadius: '4px' }}>
            <span><strong>Acme Corp (Org A):</strong> owner_a@demo.com</span>
            <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => handleQuickLogin('owner_a@demo.com')}>Fill</button>
          </div>
          <div className="flex items-center justify-between p-sm" style={{ background: 'var(--bg-primary)', borderRadius: '4px' }}>
            <span><strong>Beta Inc (Org B):</strong> owner_b@demo.com</span>
            <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => handleQuickLogin('owner_b@demo.com')}>Fill</button>
          </div>
          <div className="flex items-center justify-between p-sm" style={{ background: 'var(--bg-primary)', borderRadius: '4px' }}>
            <span><strong>Viewer (Org B):</strong> viewer_b@demo.com</span>
            <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => handleQuickLogin('viewer_b@demo.com')}>Fill</button>
          </div>
        </div>
      </div>
    </div>
  );
}
