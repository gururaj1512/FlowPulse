'use client';

/**
 * Workflow Run Viewer — Live Step-by-Step Status via GraphQL Subscription
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthenticationStatus } from '@nhost/react';
import { useSubscription, useMutation } from '@apollo/client/react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useOrg } from '@/app/Providers';
import { SUBSCRIBE_STEP_RUNS, SUBSCRIBE_WORKFLOW_RUN, APPROVE_STEP } from '@/lib/graphql';

export default function RunViewerPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const { currentRole } = useOrg();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/');
  }, [isAuthenticated, authLoading, router]);

  // Subscribe to step_runs — real-time feed
  const { data: stepsData, loading: stepsLoading } = useSubscription(SUBSCRIBE_STEP_RUNS, {
    variables: { workflowRunId: params.runId },
    skip: !params.runId,
  });

  // Subscribe to run's overall status
  const { data: runData } = useSubscription(SUBSCRIBE_WORKFLOW_RUN, {
    variables: { runId: params.runId },
    skip: !params.runId,
  });

  const stepRuns = stepsData?.step_runs || [];
  const workflowRun = runData?.workflow_runs_by_pk;

  const completedCount = stepRuns.filter(s => s.status === 'completed').length;
  const progressPercent = stepRuns.length > 0 ? Math.round((completedCount / stepRuns.length) * 100) : 0;

  if (authLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Navbar />
        <div className="loading-center" style={{ flex: 1 }}>
          <div className="spinner spinner-lg" />
          <p>Connecting to live execution stream...</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <div className="page-container">
        {/* Page Header */}
        <div className="page-header mb-lg">
          <div className="flex items-center gap-md">
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={() => router.push(`/workflow/${params.id}`)}
            >
              ← BACK TO PIPELINE
            </button>
            <div style={{ flex: 1 }}>
              <h1 className="page-title">
                WORKFLOW RUN EXECUTION
                {workflowRun && (
                  <span className={`status-badge status-${workflowRun.status}`} style={{ marginLeft: '12px' }}>
                    {workflowRun.status}
                  </span>
                )}
              </h1>
              <p className="page-subtitle font-mono text-xs">
                RUN ID: {params.runId}
                {workflowRun?.started_at && (
                  <> · STARTED: {new Date(workflowRun.started_at).toLocaleTimeString()}</>
                )}
                {workflowRun?.completed_at && (
                  <> · FINISHED: {new Date(workflowRun.completed_at).toLocaleTimeString()}</>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Bar Card */}
        {stepRuns.length > 0 && (
          <div className="glass-card mb-lg" style={{ padding: '20px' }}>
            <div className="flex items-center justify-between mb-sm">
              <span className="text-xs font-mono text-secondary" style={{ fontWeight: 700 }}>
                EXECUTION PROGRESS ({completedCount}/{stepRuns.length} STEPS COMPLETED)
              </span>
              <span className="text-xs font-mono text-gold" style={{ fontWeight: 800 }}>
                {progressPercent}%
              </span>
            </div>
            <div className="quota-bar" style={{ width: '100%', height: '8px' }}>
              <div 
                className="quota-bar-fill" 
                style={{ 
                  width: `${progressPercent}%`,
                  background: workflowRun?.status === 'failed' ? 'var(--status-failed)' : 'var(--accent-gold-gradient)'
                }} 
              />
            </div>
          </div>
        )}

        {/* Status Callout Banners */}
        {workflowRun?.status === 'running' && (
          <div className="glass-card glass-card-sm flex items-center gap-sm mb-lg animate-fade-in"
               style={{ borderColor: 'rgba(56, 189, 248, 0.4)', background: 'rgba(56, 189, 248, 0.05)' }}>
            <div className="spinner" />
            <span className="text-sm font-mono" style={{ color: 'var(--status-running)', fontWeight: 600 }}>
              LIVE STREAM — WORKFLOW IS EXECUTING STEPS IN REAL-TIME VIA GRAPHQL SUBSCRIPTION.
            </span>
          </div>
        )}

        {workflowRun?.status === 'paused' && (
          <div className="glass-card glass-card-sm flex items-center gap-sm mb-lg animate-fade-in"
               style={{ borderColor: 'var(--accent-gold)', background: 'rgba(245, 158, 11, 0.08)', boxShadow: 'var(--shadow-gold)' }}>
            <span style={{ fontSize: '1.4rem' }}>⏸</span>
            <div>
              <div className="text-sm font-mono text-gold" style={{ fontWeight: 800 }}>
                PAUSED ON APPROVAL GATE
              </div>
              <div className="text-xs text-secondary">
                Execution is halted awaiting manual review and authorization.
              </div>
            </div>
          </div>
        )}

        {stepsLoading && (
          <div className="loading-center">
            <div className="spinner spinner-lg" />
            <p>Connecting to live WebSocket subscription...</p>
          </div>
        )}

        {/* Step Timeline Stream */}
        <div className="step-timeline">
          {stepRuns.map((stepRun) => (
            <StepRunCard 
              key={stepRun.id} 
              stepRun={stepRun} 
              role={currentRole}
            />
          ))}
        </div>

        {stepRuns.length === 0 && !stepsLoading && (
          <div className="empty-state glass-card">
            <div className="spinner spinner-lg" style={{ margin: '0 auto 16px' }} />
            <h3>INITIALIZING STEPS...</h3>
            <p className="text-sm text-muted">Step execution records will populate here in real-time.</p>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}

function StepRunCard({ stepRun, role }) {
  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);
  const [approveError, setApproveError] = useState(null);
  const [showOutput, setShowOutput] = useState(true);

  const step = stepRun.workflow_step;
  const isPaused = stepRun.status === 'paused';
  const isRunning = stepRun.status === 'running';
  const isCompleted = stepRun.status === 'completed';
  const isFailed = stepRun.status === 'failed';

  const handleApprove = async () => {
    setApproveError(null);
    try {
      await approveStep({ variables: { stepRunId: stepRun.id } });
    } catch (err) {
      setApproveError(err.message);
    }
  };

  return (
    <div 
      className={`step-timeline-item animate-slide-in ${isRunning ? 'active' : ''} ${isPaused ? 'paused' : ''}`}
    >
      {/* Step Number Indicator */}
      <div className={`step-number ${stepRun.status}`}>
        {isCompleted ? '✓' : isFailed ? '✕' : isPaused ? '⏸' : step?.step_order}
      </div>

      <div className="step-info">
        {/* Step Header */}
        <div className="flex items-center justify-between">
          <div className="step-name">{step?.name || 'Workflow Step'}</div>
          <div className="flex items-center gap-sm">
            <span className={`status-badge status-${stepRun.status}`}>
              {stepRun.status}
            </span>
            {stepRun.attempt_count > 1 && (
              <span className="text-xs text-gold font-mono">
                ({stepRun.attempt_count} attempts)
              </span>
            )}
          </div>
        </div>

        {/* Step Meta */}
        <div className="step-meta mt-xs">
          <span className={`step-type-tag step-${step?.type}`}>
            {step?.type?.replace('_', ' ')}
          </span>
          {stepRun.started_at && (
            <span className="text-xs font-mono text-muted">
              Started: {new Date(stepRun.started_at).toLocaleTimeString()}
            </span>
          )}
          {stepRun.completed_at && stepRun.started_at && (
            <span className="text-xs font-mono text-secondary">
              ({((new Date(stepRun.completed_at) - new Date(stepRun.started_at)) / 1000).toFixed(1)}s latency)
            </span>
          )}
        </div>

        {/* Running animation */}
        {isRunning && (
          <div className="flex items-center gap-sm mt-md" style={{ color: 'var(--status-running)' }}>
            <div className="spinner" />
            <span className="text-sm font-mono">Executing step logic...</span>
          </div>
        )}

        {/* Approval Gate — Interactive Action Callout Card */}
        {isPaused && step?.type === 'approval_gate' && (
          <div className="mt-md" style={{ 
            padding: '20px',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '2px solid var(--accent-gold)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-gold)'
          }}>
            <div className="flex items-center gap-sm mb-sm">
              <span style={{ fontSize: '1.4rem' }}>✋</span>
              <h4 className="text-sm font-mono text-gold" style={{ fontWeight: 800 }}>
                APPROVAL REQUIRED TO PROCEED
              </h4>
            </div>

            <p className="text-sm text-primary mb-md" style={{ lineHeight: '1.6' }}>
              {stepRun.output?.message || 'Awaiting manual authorization before continuing execution to sensitive steps.'}
            </p>
            
            {role !== 'viewer' ? (
              <button 
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={approving}
                style={{ padding: '12px 24px' }}
              >
                {approving ? <><div className="spinner" /> RESUMING EXECUTION...</> : '✓ APPROVE & CONTINUE WORKFLOW'}
              </button>
            ) : (
              <div className="text-xs text-muted font-mono" style={{ background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '4px' }}>
                🔒 Viewer Role: Only Org Owners and Editors can approve this execution step.
              </div>
            )}

            {approveError && (
              <div className="step-error mt-md">
                ⚠️ {approveError}
              </div>
            )}
          </div>
        )}

        {/* Approved Metadata */}
        {stepRun.approved_by && (
          <div className="text-xs text-gold font-mono mt-sm flex items-center gap-xs">
            <span>✓ Approved at {new Date(stepRun.approved_at).toLocaleTimeString()}</span>
          </div>
        )}

        {/* Failure Error Trace */}
        {stepRun.error && (
          <div className="step-error">
            <strong>EXECUTION ERROR:</strong> {stepRun.error}
            {stepRun.attempt_count > 1 && (
              <span className="text-xs font-mono"> (Failed after {stepRun.attempt_count} retry attempts with exponential backoff)</span>
            )}
          </div>
        )}

        {/* JSON Output Viewer */}
        {stepRun.output && Object.keys(stepRun.output).length > 0 && (
          <div className="mt-md">
            <button 
              className="text-xs font-mono text-secondary flex items-center gap-xs"
              onClick={() => setShowOutput(!showOutput)}
              style={{ 
                background: 'none', border: 'none', 
                cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em'
              }}
            >
              <span>{showOutput ? '▾ HIDE STEP OUTPUT' : '▸ VIEW STEP OUTPUT'}</span>
            </button>
            {showOutput && (
              <div className="step-output">
                {JSON.stringify(stepRun.output, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
