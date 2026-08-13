'use client';

/**
 * Workflow Detail — View & Builder Interface with FlowPulse Design System
 * 
 * Features:
 * - Collapsible 1-at-a-time Accordion Step Cards
 * - Tabular Execution Logs with Hover Detail Popover Card
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthenticationStatus } from '@nhost/react';
import { useQuery, useMutation } from '@apollo/client/react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useOrg } from '@/app/Providers';
import { 
  GET_WORKFLOW, GET_WORKFLOW_RUNS, TRIGGER_WORKFLOW_RUN,
  ADD_STEP, DELETE_STEP, ADD_TRIGGER, DELETE_TRIGGER
} from '@/lib/graphql';

const STEP_TYPES = [
  { value: 'http_request', label: 'HTTP Request', icon: '🌐' },
  { value: 'llm_call', label: 'LLM Call', icon: '🤖' },
  { value: 'conditional_branch', label: 'Conditional Branch', icon: '🔀' },
  { value: 'approval_gate', label: 'Approval Gate', icon: '✋' },
  { value: 'db_write', label: 'DB Write', icon: '💾', ownerOnly: true },
  { value: 'notify', label: 'Notify Alert', icon: '🔔', ownerOnly: true },
];

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual Trigger', icon: '👆' },
  { value: 'webhook', label: 'Webhook API', icon: '🔗', ownerOnly: true },
  { value: 'scheduled', label: 'Scheduled Cron', icon: '⏰' },
  { value: 'database_event', label: 'DB Event', icon: '📊' },
];

const DEFAULT_CONFIGS = {
  http_request: { url: 'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,wind_speed_10m&timezone=America/New_York', method: 'GET' },
  llm_call: { prompt: 'Analyze this data and provide insights: {{previous_output}}', model: 'llama-3.3-70b-versatile' },
  conditional_branch: { condition: "output.classification === 'SEVERE'", true_label: 'Condition met', false_label: 'Condition not met' },
  approval_gate: { message: 'Please review and approve to continue.' },
  db_write: { result_type: 'analysis_result', data_template: {} },
  notify: { topic: 'flowpulse-demo', message_template: 'Workflow completed: {{previous_output}}', title: 'FlowPulse Alert' },
};

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const { currentRole } = useOrg();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/');
  }, [isAuthenticated, authLoading, router]);

  const { data, loading, refetch } = useQuery(GET_WORKFLOW, {
    variables: { id: params.id },
    skip: !params.id,
  });

  const { data: runsData, refetch: refetchRuns } = useQuery(GET_WORKFLOW_RUNS, {
    variables: { workflowId: params.id },
    skip: !params.id,
    pollInterval: 5000,
  });

  const [triggerRun, { loading: triggering }] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  
  // Single expanded step ID state (Accordion mode: only ONE open at a time)
  const [expandedStepId, setExpandedStepId] = useState(null);

  if (authLoading || loading || !data?.workflows_by_pk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navbar />
        <div className="loading-center" style={{ flex: 1 }}>
          <div className="spinner spinner-lg" />
          <p>Loading workflow pipeline details...</p>
        </div>
        <Footer />
      </div>
    );
  }

  const workflow = data.workflows_by_pk;
  const runs = runsData?.workflow_runs || [];

  const handleRun = async () => {
    try {
      const result = await triggerRun({ variables: { workflowId: workflow.id } });
      const runId = result.data?.triggerWorkflowRun?.workflow_run_id;
      if (runId) {
        router.push(`/workflow/${workflow.id}/run/${runId}`);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleAccordion = (stepId) => {
    // If clicked step is already open, collapse it; otherwise open it and close any previous!
    setExpandedStepId(prev => prev === stepId ? null : stepId);
  };

  const webhookTrigger = workflow.workflow_triggers.find(t => t.type === 'webhook');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <div className="page-container">
        {/* Header Bar */}
        <div className="page-header mb-lg">
          <div className="flex items-center gap-md">
            <button className="btn btn-secondary btn-sm" onClick={() => router.push('/dashboard')}>
              ← BACK TO DASHBOARD
            </button>
            <div style={{ flex: 1 }}>
              <h1 className="page-title">{workflow.name}</h1>
              <p className="page-subtitle">{workflow.description || 'Configured automated execution pipeline'}</p>
            </div>
            {currentRole !== 'viewer' && (
              <button className="btn btn-primary btn-lg" onClick={handleRun} disabled={triggering}>
                {triggering ? <><div className="spinner" /> STARTING...</> : '▶ RUN WORKFLOW'}
              </button>
            )}
          </div>
        </div>

        {/* Top Grid: Pipeline Steps Accordion & Triggers Sidebar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '28px', marginBottom: '32px' }}>
          {/* Left Column: Collapsible Pipeline Steps (1-at-a-time Accordion) */}
          <div className="glass-card">
            <div className="flex items-center justify-between mb-lg pb-md" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, textTransform: 'uppercase' }}>
                  PIPELINE STEPS ({workflow.workflow_steps.length})
                </h2>
                <p className="text-xs text-muted">Click any step to expand its configuration (1 open at a time)</p>
              </div>
              {currentRole !== 'viewer' && (
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAddStep(true)}>
                  + ADD STEP
                </button>
              )}
            </div>

            <div className="step-timeline">
              {workflow.workflow_steps.map((step, idx) => (
                <AccordionStepCard 
                  key={step.id} 
                  step={step} 
                  index={idx} 
                  role={currentRole} 
                  isExpanded={expandedStepId === step.id}
                  onToggle={() => handleToggleAccordion(step.id)}
                  onRefetch={refetch} 
                />
              ))}
              {workflow.workflow_steps.length === 0 && (
                <div className="empty-state">
                  <p className="text-sm text-muted">No steps configured yet. Add your first step to build your pipeline.</p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Triggers & Workflow Metadata */}
          <div className="flex flex-col gap-lg">
            <div className="glass-card">
              <div className="flex items-center justify-between mb-md pb-sm" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <h2 style={{ fontSize: '1.05rem', fontWeight: 800, textTransform: 'uppercase' }}>
                    WORKFLOW TRIGGERS ({workflow.workflow_triggers.length})
                  </h2>
                </div>
                <div className="flex gap-sm">
                  {webhookTrigger && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowWebhookModal(true)}>
                      🔗 WEBHOOK CURL
                    </button>
                  )}
                  {currentRole !== 'viewer' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowAddTrigger(true)}>
                      + ADD TRIGGER
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-sm">
                {workflow.workflow_triggers.map(trigger => (
                  <TriggerCard key={trigger.id} trigger={trigger} role={currentRole} onRefetch={refetch} />
                ))}
              </div>
            </div>

            <div className="glass-card glass-card-sm">
              <h4 className="footer-col-title mb-sm">PIPELINE INFO</h4>
              <div className="text-xs text-secondary flex flex-col gap-xs font-mono">
                <div>CREATED: {new Date(workflow.created_at || Date.now()).toLocaleDateString()}</div>
                <div>STEPS: {workflow.workflow_steps.length}</div>
                <div>TRIGGERS: {workflow.workflow_triggers.length}</div>
                <div>PRIVILEGES: {currentRole?.toUpperCase()}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Full-Width Section: Tabular Execution Logs with Hover Detail Popover */}
        <div className="glass-card mb-xl">
          <div className="flex items-center justify-between mb-lg pb-md" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, textTransform: 'uppercase' }}>
                EXECUTION LOGS ({runs.length})
              </h2>
              <p className="text-xs text-muted">Tabular execution records · Hover over any row to view step details card</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => refetchRuns()}>
              🔄 REFRESH LOGS
            </button>
          </div>

          {runs.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm text-muted">No execution runs recorded yet. Click "▶ RUN WORKFLOW" to trigger a run.</p>
            </div>
          ) : (
            <ExecutionLogsTable runs={runs} workflowId={workflow.id} router={router} />
          )}
        </div>

        {/* Add Step Modal */}
        {showAddStep && (
          <AddStepModal
            workflowId={workflow.id}
            nextOrder={workflow.workflow_steps.length + 1}
            role={currentRole}
            onClose={() => setShowAddStep(false)}
            onAdded={() => { setShowAddStep(false); refetch(); }}
          />
        )}

        {/* Add Trigger Modal */}
        {showAddTrigger && (
          <AddTriggerModal
            workflowId={workflow.id}
            role={currentRole}
            onClose={() => setShowAddTrigger(false)}
            onAdded={() => { setShowAddTrigger(false); refetch(); }}
          />
        )}

        {/* Webhook Curl Modal */}
        {showWebhookModal && (
          <WebhookCurlModal
            workflowId={workflow.id}
            secret={webhookTrigger?.config?.secret || 'demo-webhook-secret-123'}
            onClose={() => setShowWebhookModal(false)}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}

/* ── Collapsible 1-at-a-time Accordion Step Card ── */
function AccordionStepCard({ step, index, role, isExpanded, onToggle, onRefetch }) {
  const [deleteStep] = useMutation(DELETE_STEP);

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (confirm('Delete this step from workflow?')) {
      await deleteStep({ variables: { id: step.id } });
      onRefetch();
    }
  };

  const stepInfo = STEP_TYPES.find(s => s.value === step.type);

  return (
    <div className={`step-accordion-item ${isExpanded ? 'expanded' : ''}`}>
      {/* Clickable Card Header */}
      <div className="step-accordion-header" onClick={onToggle}>
        <div className="flex items-center gap-md">
          <div className="step-number" style={{ background: isExpanded ? 'var(--accent-gold)' : undefined, color: isExpanded ? '#090d16' : undefined }}>
            {index + 1}
          </div>
          <div>
            <div className="step-name">{step.name}</div>
            <div className="step-meta mt-xs">
              <span className={`step-type-tag step-${step.type}`}>
                {stepInfo?.icon} {step.type.replace('_', ' ')}
              </span>
              {['db_write', 'notify'].includes(step.type) && (
                <span className="text-xs text-gold font-mono">👑 Owner Privilege</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-md">
          {role !== 'viewer' && (
            <button 
              className="btn btn-danger btn-sm" 
              onClick={handleDelete} 
              style={{ padding: '2px 8px', fontSize: '0.7rem' }}
              title="Delete step"
            >
              ✕ REMOVE
            </button>
          )}

          <span className="step-accordion-toggle">
            {isExpanded ? '▾ HIDE CONFIG' : '▸ VIEW CONFIG'}
          </span>
        </div>
      </div>

      {/* Collapsible Expanded Body */}
      {isExpanded && (
        <div className="step-accordion-body">
          <div className="flex items-center justify-between mb-xs">
            <span className="text-xs font-mono text-secondary" style={{ fontWeight: 700 }}>
              FULL STEP CONFIGURATION (JSON):
            </span>
            <button 
              className="btn btn-secondary btn-sm" 
              style={{ padding: '2px 10px', fontSize: '0.7rem' }}
              onClick={() => {
                navigator.clipboard?.writeText(JSON.stringify(step.config, null, 2));
                alert('Configuration copied to clipboard!');
              }}
            >
              📋 COPY JSON
            </button>
          </div>
          
          <div className="code-box-full">
            {JSON.stringify(step.config, null, 2)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tabular Execution Logs Component with Hover Popover ── */
function ExecutionLogsTable({ runs, workflowId, router }) {
  const [hoveredRunId, setHoveredRunId] = useState(null);

  const activeRun = runs.find(r => r.id === hoveredRunId) || runs[0];

  return (
    <div>
      {/* Top Square Inspector Card — positioned cleanly above table */}
      <div className={`execution-top-inspector-card ${activeRun ? 'active' : ''}`}>
        {activeRun ? (
          <div>
            <div className="flex items-center justify-between mb-sm pb-xs" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-sm">
                <span className={`status-badge status-${activeRun.status}`}>{activeRun.status}</span>
                <span className="text-xs font-mono text-gold font-bold">ID: {activeRun.id}</span>
                <span className="text-xs font-mono text-secondary uppercase">
                  ({activeRun.trigger_type === 'webhook' ? '🔗 WEBHOOK TRIGGER' : '👆 MANUAL TRIGGER'})
                </span>
              </div>
              <button 
                className="btn btn-primary btn-sm"
                onClick={() => router.push(`/workflow/${workflowId}/run/${activeRun.id}`)}
                style={{ padding: '4px 14px', fontSize: '0.72rem' }}
              >
                OPEN LIVE RUN VIEWER ↗
              </button>
            </div>

            <div className="text-xs font-mono text-muted mb-xs flex items-center justify-between">
              <span>STEP BREAKDOWN INPSECTOR:</span>
              <span>Triggered: {new Date(activeRun.created_at).toLocaleString()}</span>
            </div>

            <div className="flex gap-sm" style={{ flexWrap: 'wrap', marginTop: '10px' }}>
              {activeRun.step_runs?.map((sr, i) => (
                <div 
                  key={sr.id} 
                  className="flex items-center gap-xs p-xs"
                  style={{ background: 'var(--bg-primary)', borderRadius: '6px', padding: '6px 12px', border: '1px solid var(--border-subtle)' }}
                >
                  <span className="text-xs font-mono text-muted">#{i + 1}</span>
                  <span className="text-xs font-bold text-primary">{sr.workflow_step?.name}</span>
                  <span className={`step-type-tag step-${sr.workflow_step?.type}`} style={{ fontSize: '0.62rem', padding: '1px 6px' }}>
                    {sr.workflow_step?.type?.replace('_', ' ')}
                  </span>
                  <span className={`status-badge status-${sr.status}`} style={{ fontSize: '0.62rem', padding: '1px 6px' }}>
                    {sr.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between" style={{ padding: '12px 0' }}>
            <div className="flex items-center gap-md">
              <span style={{ fontSize: '1.5rem' }}>🔍</span>
              <div>
                <h4 className="text-sm font-mono text-gold" style={{ fontWeight: 800 }}>
                  EXECUTION LOG DETAILS INSPECTOR
                </h4>
                <p className="text-xs text-muted">
                  Hover over any row in the log table below to inspect step execution statuses & timing.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Clean Tabular Data Table (Zero Popup Collisions) */}
      <div className="execution-table-wrapper">
        <table className="execution-table">
          <thead>
            <tr>
              <th>STATUS</th>
              <th>TRIGGER</th>
              <th>START TIME</th>
              <th>RUN ID</th>
              <th>STEPS SUMMARY</th>
              <th style={{ textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => {
              const completedCount = run.step_runs?.filter(s => s.status === 'completed').length || 0;
              const totalSteps = run.step_runs?.length || 0;

              return (
                <tr 
                  key={run.id}
                  className="execution-row"
                  onMouseEnter={() => setHoveredRunId(run.id)}
                  onClick={() => router.push(`/workflow/${workflowId}/run/${run.id}`)}
                >
                  <td>
                    <span className={`status-badge status-${run.status}`}>{run.status}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono uppercase text-secondary">
                      {run.trigger_type === 'webhook' ? '🔗 WEBHOOK' : '👆 MANUAL'}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-secondary">
                    {new Date(run.created_at).toLocaleTimeString()}
                  </td>
                  <td className="font-mono text-xs text-gold">
                    {run.id.substring(0, 8)}...
                  </td>
                  <td>
                    <div className="flex items-center gap-xs">
                      <span className="text-xs font-mono text-primary font-bold">
                        {completedCount}/{totalSteps}
                      </span>
                      <div className="flex gap-xs" style={{ marginLeft: '6px' }}>
                        {run.step_runs?.map(sr => (
                          <span 
                            key={sr.id}
                            style={{
                              width: '8px', height: '8px', borderRadius: '50%',
                              background: sr.status === 'completed' ? 'var(--status-completed)' :
                                          sr.status === 'paused' ? 'var(--status-paused)' :
                                          sr.status === 'running' ? 'var(--status-running)' :
                                          sr.status === 'failed' ? 'var(--status-failed)' : 'var(--status-pending)'
                            }}
                            title={`${sr.workflow_step?.name}: ${sr.status}`}
                          />
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" style={{ padding: '4px 12px' }}>
                      VIEW RUN ↗
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TriggerCard({ trigger, role, onRefetch }) {
  const [deleteTrigger] = useMutation(DELETE_TRIGGER);
  const triggerInfo = TRIGGER_TYPES.find(t => t.value === trigger.type);

  return (
    <div className="glass-card glass-card-sm flex items-center justify-between" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-sm">
        <span style={{ fontSize: '1.2rem' }}>{triggerInfo?.icon || '📎'}</span>
        <div>
          <div className="text-sm font-mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {triggerInfo?.label || trigger.type}
          </div>
          {!trigger.is_active && <span className="text-xs text-muted">(INACTIVE)</span>}
        </div>
      </div>
      {role === 'owner' && (
        <button 
          className="btn btn-danger btn-sm" 
          onClick={async () => { await deleteTrigger({ variables: { id: trigger.id } }); onRefetch(); }}
          style={{ padding: '2px 8px', fontSize: '0.7rem' }}
        >
          ✕ REMOVE
        </button>
      )}
    </div>
  );
}

function AddStepModal({ workflowId, nextOrder, role, onClose, onAdded }) {
  const [type, setType] = useState('http_request');
  const [name, setName] = useState('');
  const [config, setConfig] = useState(JSON.stringify(DEFAULT_CONFIGS.http_request, null, 2));
  const [addStep, { loading }] = useMutation(ADD_STEP);

  const handleTypeChange = (newType) => {
    setType(newType);
    setConfig(JSON.stringify(DEFAULT_CONFIGS[newType] || {}, null, 2));
    const info = STEP_TYPES.find(s => s.value === newType);
    if (!name) setName(info?.label || '');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsedConfig = JSON.parse(config);
      await addStep({
        variables: {
          workflowId,
          stepOrder: nextOrder,
          name: name || STEP_TYPES.find(s => s.value === type)?.label || type,
          type,
          config: parsedConfig,
        },
      });
      onAdded();
    } catch (err) {
      alert(err.message);
    }
  };

  const availableTypes = STEP_TYPES.filter(s => !s.ownerOnly || role === 'owner');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">ADD PIPELINE STEP (#{nextOrder})</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">STEP TYPE</label>
            <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
              {availableTypes.map(st => (
                <button
                  key={st.value}
                  type="button"
                  className={`btn btn-sm ${type === st.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTypeChange(st.value)}
                >
                  {st.icon} {st.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="step-name">STEP NAME</label>
            <input
              id="step-name"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={STEP_TYPES.find(s => s.value === type)?.label}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="step-config">CONFIGURATION (JSON)</label>
            <textarea
              id="step-config"
              className="form-textarea font-mono"
              value={config}
              onChange={e => setConfig(e.target.value)}
              rows={7}
              style={{ fontSize: '0.82rem' }}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>CANCEL</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'ADDING STEP...' : 'ADD STEP TO PIPELINE'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddTriggerModal({ workflowId, role, onClose, onAdded }) {
  const [type, setType] = useState('manual');
  const [config, setConfig] = useState('{}');
  const [addTrigger, { loading }] = useMutation(ADD_TRIGGER);

  const availableTypes = TRIGGER_TYPES.filter(t => !t.ownerOnly || role === 'owner');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await addTrigger({
        variables: { workflowId, type, config: JSON.parse(config) },
      });
      onAdded();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">ADD WORKFLOW TRIGGER</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">TRIGGER TYPE</label>
            <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
              {availableTypes.map(tt => (
                <button
                  key={tt.value}
                  type="button"
                  className={`btn btn-sm ${type === tt.value ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setType(tt.value)}
                >
                  {tt.icon} {tt.label}
                </button>
              ))}
            </div>
          </div>
          {type === 'webhook' && (
            <div className="form-group">
              <label className="form-label">WEBHOOK CONFIGURATION (JSON)</label>
              <input
                className="form-input font-mono"
                value={config}
                onChange={e => setConfig(e.target.value)}
                placeholder='{"secret": "demo-webhook-secret-123"}'
              />
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>CANCEL</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'ADDING...' : 'ADD TRIGGER'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WebhookCurlModal({ workflowId, secret, onClose }) {
  const curlCmd = `curl -k -X POST https://local.graphql.local.nhost.run/v1 \\\n  -H "Content-Type: application/json" \\\n  -H "x-hasura-admin-secret: nhost-admin-secret" \\\n  -H "x-hasura-role: user" \\\n  -d '{\n    "query": "mutation { webhookTrigger(workflow_id: \\"${workflowId}\\", webhook_secret: \\"${secret}\\") { workflow_run_id message } }"\n  }'`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h2 className="modal-title">🔗 INBOUND WEBHOOK CURL COMMAND</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p className="text-sm text-secondary mb-md">
          Execute this curl command in any terminal to trigger this workflow without pressing any button in the UI.
        </p>
        <div className="code-box-full text-xs mb-lg" style={{ maxHeight: '220px', padding: '16px' }}>
          {curlCmd}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => { navigator.clipboard?.writeText(curlCmd); alert('Copied to clipboard!'); }}>
            📋 COPY CURL COMMAND
          </button>
          <button className="btn btn-secondary" onClick={onClose}>CLOSE</button>
        </div>
      </div>
    </div>
  );
}
