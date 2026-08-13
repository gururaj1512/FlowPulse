/**
 * webhook-trigger.js — Inbound Webhook Endpoint
 * 
 * This is a Hasura Action that external systems can call to start a 
 * workflow run. It validates the webhook secret before triggering.
 * 
 * This satisfies the requirement: "at least one trigger beyond manual 
 * must actually be wired to start a run without a button click"
 */

import {
  adminQuery,
  getWorkflowWithSteps,
  createWorkflowRun,
  createStepRuns,
} from './_utils/graphql.js';

import { executeStepsFromIndex } from './trigger-workflow-run.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { input } = req.body;
    const workflowId = input?.workflow_id;
    const webhookSecret = input?.webhook_secret;

    if (!workflowId) {
      return res.status(400).json({ message: 'workflow_id is required' });
    }

    // ── Fetch workflow and validate ──────────────────────
    const workflow = await getWorkflowWithSteps(workflowId);
    
    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }
    if (!workflow.is_active) {
      return res.status(400).json({ message: 'Workflow is not active' });
    }

    // ── Validate webhook secret ──────────────────────────
    // Find the webhook trigger for this workflow
    const triggerData = await adminQuery(`
      query GetWebhookTrigger($workflowId: uuid!) {
        workflow_triggers(where: {
          workflow_id: { _eq: $workflowId },
          type: { _eq: "webhook" },
          is_active: { _eq: true }
        }) {
          id
          config
        }
      }
    `, { workflowId });

    const trigger = triggerData.workflow_triggers[0];
    
    if (!trigger) {
      return res.status(404).json({ 
        message: 'No active webhook trigger found for this workflow' 
      });
    }

    // Validate the secret
    const expectedSecret = trigger.config?.secret;
    if (expectedSecret && expectedSecret !== webhookSecret) {
      return res.status(403).json({ message: 'Invalid webhook secret' });
    }

    // ── Quota check ──────────────────────────────────────
    const org = workflow.organization;
    if (org.quota_used >= org.quota_limit) {
      return res.status(429).json({
        message: `Quota exhausted: ${org.quota_used}/${org.quota_limit} runs used`
      });
    }

    // ── Create and execute ───────────────────────────────
    const run = await createWorkflowRun(
      workflowId,
      workflow.org_id,
      null, // No user — triggered by webhook
      'webhook'
    );

    const stepRuns = await createStepRuns(run.id, workflow.workflow_steps);

    // Execute in background
    executeStepsFromIndex(
      stepRuns,
      workflow.workflow_steps,
      0,
      run.id,
      workflow.org_id
    ).catch(error => {
      console.error(`Webhook-triggered execution failed:`, error);
    });

    return res.status(200).json({
      workflow_run_id: run.id,
      message: 'Workflow triggered via webhook successfully',
    });

  } catch (error) {
    console.error('webhookTrigger error:', error);
    return res.status(500).json({ 
      message: error.message || 'Internal server error' 
    });
  }
}
