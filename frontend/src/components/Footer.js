'use client';

/**
 * Footer — Professional site footer matching BunkBikes reference design
 */

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <div className="footer-brand">
            <span style={{ 
              background: 'var(--accent-gold-gradient)', 
              color: '#090d16', 
              width: '24px', 
              height: '24px', 
              borderRadius: '4px', 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              fontSize: '0.8rem'
            }}>⚡</span>
            FlowPulse
          </div>
          <p className="text-sm text-secondary" style={{ maxWidth: '320px', lineHeight: '1.6' }}>
            Enterprise multi-tenant workflow automation with real-time execution tracking, LLM integrations, and cross-org authorization.
          </p>
        </div>

        <div>
          <h4 className="footer-col-title">Platform</h4>
          <ul className="footer-links">
            <li><a href="/dashboard">Workflows</a></li>
            <li><a href="/dashboard">Execution Logs</a></li>
            <li><a href="/dashboard">Organization Quotas</a></li>
            <li><a href="/dashboard">Role Permissions</a></li>
          </ul>
        </div>

        <div>
          <h4 className="footer-col-title">Integrations</h4>
          <ul className="footer-links">
            <li><a href="#llm">Groq AI (Llama 3.3)</a></li>
            <li><a href="#http">Open-Meteo API</a></li>
            <li><a href="#ntfy">ntfy.sh Alerts</a></li>
            <li><a href="#webhooks">Inbound Webhooks</a></li>
          </ul>
        </div>

        <div>
          <h4 className="footer-col-title">System Status</h4>
          <div className="glass-card glass-card-sm" style={{ background: 'var(--bg-primary)' }}>
            <div className="flex items-center gap-sm mb-md">
              <span style={{ 
                width: '8px', 
                height: '8px', 
                borderRadius: '50%', 
                background: 'var(--status-completed)',
                boxShadow: '0 0 10px var(--status-completed)'
              }} />
              <span className="text-xs font-mono" style={{ color: 'var(--status-completed)', fontWeight: 600 }}>
                ALL SYSTEMS OPERATIONAL
              </span>
            </div>
            <div className="text-xs text-muted" style={{ lineHeight: '1.5' }}>
              Nhost GraphQL · PostgreSQL 14 · Traefik Proxy · Groq LLM API
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div>© 2026 FlowPulse Workflow Platform. All rights reserved.</div>
        <div className="flex gap-md">
          <span>Security: Layer 1 + Layer 2</span>
          <span>·</span>
          <span>Multi-Tenant Auth</span>
          <span>·</span>
          <span>GraphQL Subscriptions</span>
        </div>
      </div>
    </footer>
  );
}
