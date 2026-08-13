/**
 * approve-step.js — Approval Gate Handler
 * 
 * This is a Hasura Action handler that approves a paused approval_gate step
 * and resumes workflow execution.
 * 
 * LAYER 2 CHECK (enforced here, not in Hasura permissions):
 * Only an owner or editor in the step's organization can approve.
 * 
 * WHY THIS CAN'T BE A DATABASE PERMISSION:
 * 1. Approving a step isn't just updating a row — it triggers RESUMPTION
 *    of the workflow execution pipeline. A Hasura update permission could
 *    let someone set approved_by/approved_at, but it can't also cause
 *    the remaining steps to execute.
 * 2. The approval check needs to verify the approver's role in the 
 *    STEP'S org (traversing step_run → workflow_run → org → org_members),
 *    which is a multi-hop relationship check combined with a write + 
 *    side effect (resume execution).
 * 3. Even if we split it into an update permission + a database trigger,
 *    the trigger wouldn't have access to the approver's role context.
 */

import {
  getUserOrgRole,
  adminQuery,
  updateStepRun,
  updateWorkflowRun,
} from './_utils/graphql.js';

import { executeStepsFromIndex } from './trigger-workflow-run.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { input, session_variables } = req.body;
    const stepRunId = input?.step_run_id;
    const userId = session_variables?.['x-hasura-user-id'];

    if (!stepRunId) {
      return res.status(400).json({ message: 'step_run_id is required' });
    }
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // ── Fetch the step_run with its context ──────────────
    const data = await adminQuery(`
      query GetStepRunContext($stepRunId: uuid!) {
        step_runs_by_pk(id: $stepRunId) {
          id
          status
          workflow_step_id
          workflow_run_id
          workflow_run {
            id
            org_id
            status
            workflow_id
            workflow {
              workflow_steps(order_by: { step_order: asc }) {
                id
                step_order
                name
                type
                config
              }
            }
          }
          workflow_step {
            id
            step_order
            type
          }
        }
      }
    `, { stepRunId });

    const stepRun = data.step_runs_by_pk;

    if (!stepRun) {
      return res.status(404).json({ message: 'Step run not found' });
    }

    // ── Verify the step is actually paused ────────────────
    if (stepRun.status !== 'paused') {
      return res.status(400).json({ 
        message: `Cannot approve: step is in '${stepRun.status}' status, not 'paused'` 
      });
    }

    if (stepRun.workflow_step.type !== 'approval_gate') {
      return res.status(400).json({ 
        message: 'Cannot approve: this is not an approval_gate step' 
      });
    }

    // ── LAYER 2 CHECK: Verify approver is owner/editor ───
    // WHY IN CODE: This is a mid-execution authorization decision.
    // We need to check the user's role in the SPECIFIC org that 
    // owns this workflow, AND then trigger execution resumption.
    // Hasura permissions can gate row access but can't trigger 
    // side effects (continuing workflow execution) based on the
    // result of a permission check.
    const orgId = stepRun.workflow_run.org_id;
    const membership = await getUserOrgRole(userId, orgId);

    if (!membership) {
      return res.status(403).json({ 
        message: 'Access denied: you are not a member of this organization' 
      });
    }
    if (membership.role === 'viewer') {
      return res.status(403).json({ 
        message: 'Access denied: only owners and editors can approve steps' 
      });
    }

    // ── Approve the step ──────────────────────────────────
    await updateStepRun(stepRunId, {
      status: 'completed',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    // ── Resume workflow execution ─────────────────────────
    // Set run back to 'running'
    await updateWorkflowRun(stepRun.workflow_run_id, { status: 'running' });

    // Find the index of the next step to execute
    const workflowSteps = stepRun.workflow_run.workflow.workflow_steps;
    const currentStepIndex = workflowSteps.findIndex(
      s => s.id === stepRun.workflow_step_id
    );
    const nextStepIndex = currentStepIndex + 1;

    if (nextStepIndex < workflowSteps.length) {
      // Get all step_runs for this workflow_run
      const stepRunsData = await adminQuery(`
        query GetStepRuns($runId: uuid!) {
          step_runs(where: { workflow_run_id: { _eq: $runId } }) {
            id
            workflow_step_id
            status
          }
        }
      `, { runId: stepRun.workflow_run_id });

      // Resume execution from the next step (don't await)
      executeStepsFromIndex(
        stepRunsData.step_runs,
        workflowSteps,
        nextStepIndex,
        stepRun.workflow_run_id,
        orgId
      ).catch(error => {
        console.error(`Resume execution failed:`, error);
        updateWorkflowRun(stepRun.workflow_run_id, {
          status: 'failed',
          completed_at: new Date().toISOString(),
        }).catch(console.error);
      });
    } else {
      // No more steps — mark run as completed
      await updateWorkflowRun(stepRun.workflow_run_id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      success: true,
      message: `Step approved by ${userId}. Workflow execution resuming.`,
    });

  } catch (error) {
    console.error('approveStep error:', error);
    return res.status(500).json({ 
      message: error.message || 'Internal server error' 
    });
  }
}
