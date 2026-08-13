'use client';

/**
 * Dashboard — Workflow List with Run Controls
 * 
 * Shows all workflows in the currently selected organization with BunkBikes-inspired
 * dark aesthetic, carousel filter tabs, stats overview, and role enforcement.
 */

import { useEffect, useState } from 'react';
import { useAuthenticationStatus } from '@nhost/react';
import { useQuery, useMutation } from '@apollo/client/react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useOrg } from '@/app/Providers';
import { GET_WORKFLOWS, TRIGGER_WORKFLOW_RUN, CREATE_WORKFLOW } from '@/lib/graphql';

export default function DashboardPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const router = useRouter();
  const { currentOrg, currentRole } = useOrg();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, authLoading, router]);

  if (authLoading || !isAuthenticated) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="spinner spinner-lg" />
        <p>Loading session...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <div className="page-container">
        {currentOrg ? (
          <DashboardContent org={currentOrg} role={currentRole} />
        ) : (
          <div className="loading-center">
            <div className="spinner spinner-lg" />
            <p>Loading organization workspace...</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}

function DashboardContent({ org, role }) {
  const { data, loading, error, refetch } = useQuery(GET_WORKFLOWS, {
    variables: { orgId: org.id },
    skip: !org.id,
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');

  const workflows = data?.workflows || [];

  // Filter workflows by tab
  const filteredWorkflows = workflows.filter(wf => {
    if (activeTab === 'ALL') return true;
    const status = wf.workflow_runs?.[0]?.status || 'pending';
    if (activeTab === 'ACTIVE') return wf.is_active;
    if (activeTab === 'COMPLETED') return status === 'completed';
    if (activeTab === 'PAUSED') return status === 'paused';
    return true;
  });

  const totalRuns = workflows.reduce((acc, wf) => acc + (wf.workflow_runs?.length || 0), 0);

  return (
    <>
      {/* Hero Banner Header */}
      <div className="hero-banner">
        <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div className="flex items-center gap-sm mb-md">
              <span className={`role-badge role-${role}`}>{role} ACCESS</span>
              <span className="text-xs font-mono text-muted">ID: {org.id.substring(0, 8)}...</span>
            </div>
            <h1 className="page-title">{org.name}</h1>
            <p className="page-subtitle">
              Manage automated pipelines, monitor step execution, and trigger actions.
            </p>
          </div>
          {role !== 'viewer' && (
            <button className="btn btn-primary btn-lg" onClick={() => setShowCreateModal(true)}>
              + NEW WORKFLOW
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="grid-stats">
        <div className="stat-card">
          <div className="stat-label">TOTAL WORKFLOWS</div>
          <div className="stat-value">{workflows.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">TOTAL EXECUTIONS</div>
          <div className="stat-value">{totalRuns}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PERIOD QUOTA</div>
          <div className="stat-value" style={{ color: org.quota_used >= org.quota_limit ? 'var(--status-failed)' : 'var(--text-gold)' }}>
            {org.quota_used} / {org.quota_limit}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">ROLE PRIVILEGES</div>
          <div className="stat-value" style={{ fontSize: '1.25rem', textTransform: 'uppercase' }}>
            {role === 'owner' ? '👑 Owner' : role === 'editor' ? '⚡ Editor' : '👁️ Viewer'}
          </div>
        </div>
      </div>

      {/* Carousel / Filter Tab Bar (BunkBikes Reference Aesthetic) */}
      <div className="tab-bar">
        <button 
          className={`tab-item ${activeTab === 'ALL' ? 'active' : ''}`}
          onClick={() => setActiveTab('ALL')}
        >
          ALL WORKFLOWS <span className="tab-badge">{workflows.length}</span>
        </button>
        <button 
          className={`tab-item ${activeTab === 'ACTIVE' ? 'active' : ''}`}
          onClick={() => setActiveTab('ACTIVE')}
        >
          ACTIVE PIPELINES <span className="tab-badge">{workflows.filter(w => w.is_active).length}</span>
        </button>
        <button 
          className={`tab-item ${activeTab === 'PAUSED' ? 'active' : ''}`}
          onClick={() => setActiveTab('PAUSED')}
        >
          PAUSED GATES <span className="tab-badge">{workflows.filter(w => w.workflow_runs?.[0]?.status === 'paused').length}</span>
        </button>
        <button 
          className={`tab-item ${activeTab === 'COMPLETED' ? 'active' : ''}`}
          onClick={() => setActiveTab('COMPLETED')}
        >
          COMPLETED <span className="tab-badge">{workflows.filter(w => w.workflow_runs?.[0]?.status === 'completed').length}</span>
        </button>
      </div>

      {loading && (
        <div className="loading-center">
          <div className="spinner spinner-lg" />
          <p>Fetching workflow pipelines...</p>
        </div>
      )}

      {error && (
        <div className="login-error">Error loading workflows: {error.message}</div>
      )}

      {!loading && filteredWorkflows.length === 0 && (
        <div className="empty-state glass-card">
          <div className="empty-state-icon">⚡</div>
          <h3>NO WORKFLOWS FOUND</h3>
          <p>No workflows match your selected filter. Create a workflow to get started.</p>
        </div>
      )}

      {/* Structured Card Grid */}
      <div className="grid-2">
        {filteredWorkflows.map(workflow => (
          <WorkflowCard 
            key={workflow.id} 
            workflow={workflow} 
            role={role}
            orgId={org.id}
            onRefetch={refetch}
          />
        ))}
      </div>

      {showCreateModal && (
        <CreateWorkflowModal 
          orgId={org.id} 
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); refetch(); }}
        />
      )}
    </>
  );
}

function WorkflowCard({ workflow, role, orgId, onRefetch }) {
  const router = useRouter();
  const [triggerRun, { loading: triggering }] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [runError, setRunError] = useState(null);

  const latestRun = workflow.workflow_runs?.[0];

  const handleRun = async (e) => {
    e.stopPropagation();
    setRunError(null);
    try {
      const result = await triggerRun({ variables: { workflowId: workflow.id } });
      const runId = result.data?.triggerWorkflowRun?.workflow_run_id;
      if (runId) {
        router.push(`/workflow/${workflow.id}/run/${runId}`);
      }
    } catch (err) {
      setRunError(err.message);
    }
  };

  return (
    <div 
      className="glass-card workflow-card animate-fade-in workflow-card-container"
      onClick={() => router.push(`/workflow/${workflow.id}`)}
    >
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: '12px' }}>
          <h3 className="workflow-card-title">{workflow.name}</h3>
          {latestRun ? (
            <span className={`status-badge status-${latestRun.status}`}>
              {latestRun.status}
            </span>
          ) : (
            <span className="status-badge status-pending">READY</span>
          )}
        </div>
        
        {workflow.description && (
          <p className="workflow-card-desc">
            {workflow.description}
          </p>
        )}

        <div className="workflow-steps-preview">
          {workflow.workflow_steps.map(step => (
            <span key={step.id} className={`step-type-tag step-${step.type}`}>
              {step.type.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-xs text-muted font-mono">
            {workflow.workflow_steps.length} STEPS · {workflow.workflow_triggers.length} TRIGGERS
          </div>

          {role !== 'viewer' ? (
            <button 
              className="btn btn-primary btn-sm"
              onClick={handleRun}
              disabled={triggering || !workflow.is_active}
            >
              {triggering ? <><div className="spinner" /> EXECUTING...</> : '▶ RUN WORKFLOW'}
            </button>
          ) : (
            <span className="text-xs font-mono text-muted" style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '4px' }}>
              🔒 VIEW ONLY
            </span>
          )}
        </div>

        {runError && (
          <div className="step-error" style={{ marginTop: '12px' }}>
            {runError}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateWorkflowModal({ orgId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createWorkflow, { loading }] = useMutation(CREATE_WORKFLOW);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createWorkflow({
        variables: { orgId, name, description },
      });
      onCreated();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">CREATE NEW WORKFLOW</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="wf-name">WORKFLOW NAME</label>
            <input
              id="wf-name"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Weather Analysis Pipeline"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="wf-desc">DESCRIPTION</label>
            <textarea
              id="wf-desc"
              className="form-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the purpose and steps of this workflow pipeline..."
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>CANCEL</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name}>
              {loading ? 'CREATING...' : 'CREATE WORKFLOW'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
