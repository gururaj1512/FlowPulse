/**
 * trigger-workflow-run.js — Main Workflow Execution Handler
 * 
 * This is a Hasura Action handler that orchestrates workflow execution.
 * It's the most critical piece of the system.
 * 
 * WHAT THIS HANDLER DOES:
 * 1. Receives a workflow_id from the Hasura Action
 * 2. Extracts the caller's user_id from Hasura session variables
 * 3. LAYER 2 CHECK: Verifies the caller is an owner or editor in the workflow's org
 * 4. QUOTA CHECK: Verifies the org hasn't exhausted its monthly quota
 * 5. Creates a workflow_run record and step_run records
 * 6. Executes steps in order, updating statuses in real-time (for subscriptions)
 * 7. On approval_gate: pauses the run and stops execution
 * 8. On completion: increments the org's quota usage
 * 
 * WHY LAYER 2 IS HERE (NOT IN HASURA):
 * - Hasura permissions control WHO can access WHICH rows
 * - But they can't enforce "only owners can trigger runs that contain db_write steps"
 * - They can't enforce "check quota before allowing execution"
 * - They can't enforce "pause at approval gates and resume later"
 * - These are all runtime business logic decisions that require code
 */

import {
  getUserOrgRole,
  getWorkflowWithSteps,
  createWorkflowRun,
  createStepRuns,
  updateStepRun,
  updateWorkflowRun,
  incrementOrgQuota,
  adminQuery,
} from './_utils/graphql.js';

import {
  executeLlmCall,
  executeHttpRequest,
  executeDbWrite,
  executeConditionalBranch,
  executeNotify,
  executeApprovalGate,
} from './_utils/step-executors.js';

/**
 * Execute steps starting from a given index. This is called both 
 * for initial runs and when resuming after an approval.
 */
export async function executeStepsFromIndex(stepRuns, steps, startIndex, workflowRunId, orgId) {
  let previousOutput = null;
  
  // If resuming, get the output from the step before startIndex
  if (startIndex > 0) {
    const previousStepRun = stepRuns.find(
      sr => sr.workflow_step_id === steps[startIndex - 1].id
    );
    if (previousStepRun) {
      // Fetch the step run's output
      const data = await adminQuery(`
        query GetStepOutput($id: uuid!) {
          step_runs_by_pk(id: $id) {
            output
          }
        }
      `, { id: previousStepRun.id });
      previousOutput = data.step_runs_by_pk?.output;
    }
  }

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];
    const stepRun = stepRuns.find(sr => sr.workflow_step_id === step.id);
    
    if (!stepRun) {
      console.error(`No step_run found for step ${step.id}`);
      continue;
    }

    // Mark step as running
    await updateStepRun(stepRun.id, {
      status: 'running',
      started_at: new Date().toISOString(),
    });

    try {
      let executionResult;

      switch (step.type) {
        case 'llm_call':
          executionResult = await executeLlmCall(step.config, previousOutput);
          break;
          
        case 'http_request':
          executionResult = await executeHttpRequest(step.config, previousOutput);
          break;
          
        case 'db_write':
          executionResult = await executeDbWrite(step.config, previousOutput, {
            workflowRunId,
            orgId,
          });
          break;
          
        case 'conditional_branch':
          executionResult = await executeConditionalBranch(step.config, previousOutput);
          break;
          
        case 'notify':
          executionResult = await executeNotify(step.config, previousOutput);
          break;
          
        case 'approval_gate':
          executionResult = await executeApprovalGate(step.config);
          break;
          
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // Handle approval gate — pause the run
      if (executionResult.pause) {
        await updateStepRun(stepRun.id, {
          status: 'paused',
          output: executionResult.result,
          attempt_count: executionResult.attempts,
          completed_at: null, // Not completed, just paused
        });
        
        // Pause the overall run
        await updateWorkflowRun(workflowRunId, { status: 'paused' });
        
        console.log(`Run ${workflowRunId} paused at approval gate step ${step.id}`);
        return { paused: true, pausedAtStep: step.id };
      }

      // Handle conditional branch — may skip subsequent steps
      if (step.type === 'conditional_branch' && !executionResult.result.branch_taken) {
        // Branch not taken: mark this step as completed
        await updateStepRun(stepRun.id, {
          status: 'completed',
          output: executionResult.result,
          attempt_count: executionResult.attempts,
          completed_at: new Date().toISOString(),
        });
        previousOutput = executionResult.result;
        
        // Continue to next step — the branch result is informational
        // In this design, we DON'T skip steps on false branch.
        // The conditional_branch output is available to subsequent steps
        // for their own decision-making.
        continue;
      }

      // Step completed successfully
      await updateStepRun(stepRun.id, {
        status: 'completed',
        output: executionResult.result,
        attempt_count: executionResult.attempts,
        completed_at: new Date().toISOString(),
      });

      previousOutput = executionResult.result;

    } catch (error) {
      const errorInfo = error.error || error;
      const attempts = error.attempts || 1;
      
      // Step failed after all retries
      await updateStepRun(stepRun.id, {
        status: 'failed',
        error: errorInfo.message || String(errorInfo),
        attempt_count: attempts,
        completed_at: new Date().toISOString(),
      });

      // Fail the whole run
      await updateWorkflowRun(workflowRunId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
      });

      console.error(`Run ${workflowRunId} failed at step ${step.id}:`, errorInfo.message);
      return { failed: true, failedAtStep: step.id, error: errorInfo.message };
    }
  }

  // All steps completed successfully
  await updateWorkflowRun(workflowRunId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
  });

  // Increment org quota usage
  await incrementOrgQuota(orgId);
  
  console.log(`Run ${workflowRunId} completed successfully`);
  return { completed: true };
}

/**
 * Main handler — Hasura Action entry point.
 * Nhost serverless functions use Express.js (req, res) format.
 */
export default async function handler(req, res) {
  // Only accept POST (Hasura Actions always POST)
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // ── Extract inputs from Hasura Action payload ──────────
    const { input, session_variables } = req.body;
    const workflowId = input?.workflow_id;
    const userId = session_variables?.['x-hasura-user-id'];

    if (!workflowId) {
      return res.status(400).json({ message: 'workflow_id is required' });
    }
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // ── Fetch the workflow with its org and steps ──────────
    const workflow = await getWorkflowWithSteps(workflowId);
    
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }
    if (!workflow.is_active) {
      return res.status(400).json({ message: 'Workflow is not active' });
    }

    // ── LAYER 2 CHECK: Verify caller is owner/editor ──────
    // WHY IN CODE: This check combines org membership verification 
    // with a role check AND quota enforcement — a multi-step 
    // authorization decision that can't be expressed as a single 
    // Hasura permission filter. Hasura permissions can restrict  
    // row access, but can't prevent a mutation based on a related 
    // table's quota value.
    const membership = await getUserOrgRole(userId, workflow.org_id);
    
    if (!membership) {
      return res.status(403).json({ 
        message: 'Access denied: you are not a member of this organization' 
      });
    }
    if (membership.role === 'viewer') {
      return res.status(403).json({ 
        message: 'Access denied: viewers cannot trigger workflow runs' 
      });
    }

    // ── LAYER 2 CHECK: Step-type restrictions ──────────────
    // WHY IN CODE: Hasura permissions can control WHO inserts a 
    // workflow_step row, but cannot restrict inserts based on the 
    // VALUE of the 'type' column. For example, there's no way to 
    // write a Hasura permission that says "editors can insert steps, 
    // but only if type != 'db_write'". This requires inspecting 
    // the step type at runtime.
    const restrictedStepTypes = ['db_write', 'notify'];
    const hasRestrictedSteps = workflow.workflow_steps.some(
      step => restrictedStepTypes.includes(step.type)
    );
    
    if (hasRestrictedSteps && membership.role !== 'owner') {
      return res.status(403).json({
        message: 'Access denied: this workflow contains steps (db_write/notify) that require owner privileges to run'
      });
    }

    // ── QUOTA CHECK ───────────────────────────────────────
    const org = workflow.organization;
    if (org.quota_used >= org.quota_limit) {
      return res.status(429).json({
        message: `Quota exhausted: ${org.quota_used}/${org.quota_limit} runs used this period. Please contact your org owner.`
      });
    }

    // ── CREATE RUN & STEP RUNS ────────────────────────────
    const run = await createWorkflowRun(
      workflowId, 
      workflow.org_id, 
      userId, 
      'manual'
    );

    const stepRuns = await createStepRuns(run.id, workflow.workflow_steps);

    // ── EXECUTE STEPS ─────────────────────────────────────
    // This updates step_run statuses in real-time, which the 
    // frontend subscription picks up automatically.
    // We DON'T await this — we return the run ID immediately
    // and let execution continue in the background.
    // Note: In nhost serverless functions, the response is sent
    // but the function continues executing until completion.
    
    // Start execution (don't await — let it run in background)
    executeStepsFromIndex(
      stepRuns,
      workflow.workflow_steps,
      0,
      run.id,
      workflow.org_id
    ).catch(error => {
      console.error(`Background execution failed for run ${run.id}:`, error);
      updateWorkflowRun(run.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
      }).catch(console.error);
    });

    // Return immediately with the run ID so the frontend can 
    // subscribe to step_runs updates
    return res.status(200).json({
      workflow_run_id: run.id,
      message: `Workflow run started. Subscribe to step_runs for live status.`,
    });

  } catch (error) {
    console.error('triggerWorkflowRun error:', error);
    return res.status(500).json({ 
      message: error.message || 'Internal server error' 
    });
  }
}
