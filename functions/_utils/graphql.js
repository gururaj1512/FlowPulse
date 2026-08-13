/**
 * _utils/graphql.js — Admin GraphQL Client
 * 
 * This module provides a way for serverless functions to make GraphQL 
 * mutations/queries to Hasura using the admin secret. This is necessary
 * because Action handlers need to update step_runs and workflow_runs 
 * during execution, and those updates bypass normal user permissions
 * (the handler has already verified authorization via Layer 2 checks).
 * 
 * WHY ADMIN SECRET: The handler receives the user's session variables
 * from Hasura for authorization checks, but needs elevated privileges
 * to update execution state (step statuses, run statuses, etc.) that
 * normal users shouldn't be able to modify directly.
 */

// Nhost provides these environment variables automatically:
// - NHOST_GRAPHQL_URL: The GraphQL endpoint URL  
// - NHOST_ADMIN_SECRET (via HASURA_GRAPHQL_ADMIN_SECRET): Admin access key
const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || 'http://localhost:1337/v1/graphql';
const ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'nhost-admin-secret';

/**
 * Execute a GraphQL operation with admin privileges.
 * Used by Action handlers to update step/run statuses during execution.
 */
export async function adminQuery(query, variables = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  
  if (result.errors) {
    console.error('GraphQL Error:', JSON.stringify(result.errors));
    throw new Error(result.errors[0].message);
  }
  
  return result.data;
}

/**
 * Get the caller's org membership and role.
 * Used by Layer 2 checks to verify the user has the right role.
 */
export async function getUserOrgRole(userId, orgId) {
  const data = await adminQuery(`
    query GetUserOrgRole($userId: uuid!, $orgId: uuid!) {
      org_members(where: {
        user_id: { _eq: $userId },
        org_id: { _eq: $orgId }
      }) {
        id
        role
        org_id
        user_id
      }
    }
  `, { userId, orgId });

  return data.org_members[0] || null;
}

/**
 * Get a workflow with its org_id and steps (ordered).
 */
export async function getWorkflowWithSteps(workflowId) {
  const data = await adminQuery(`
    query GetWorkflow($workflowId: uuid!) {
      workflows_by_pk(id: $workflowId) {
        id
        org_id
        name
        is_active
        organization {
          id
          name
          quota_limit
          quota_used
        }
        workflow_steps(order_by: { step_order: asc }) {
          id
          step_order
          name
          type
          config
        }
      }
    }
  `, { workflowId });

  return data.workflows_by_pk;
}

/**
 * Create a workflow_run record.
 */
export async function createWorkflowRun(workflowId, orgId, triggeredBy, triggerType) {
  const data = await adminQuery(`
    mutation CreateRun($workflowId: uuid!, $orgId: uuid!, $triggeredBy: uuid, $triggerType: String!) {
      insert_workflow_runs_one(object: {
        workflow_id: $workflowId,
        org_id: $orgId,
        status: "running",
        triggered_by: $triggeredBy,
        trigger_type: $triggerType,
        started_at: "now()"
      }) {
        id
        status
      }
    }
  `, { workflowId, orgId, triggeredBy, triggerType });

  return data.insert_workflow_runs_one;
}

/**
 * Create step_run records for all steps in a workflow.
 */
export async function createStepRuns(workflowRunId, steps) {
  const objects = steps.map(step => ({
    workflow_run_id: workflowRunId,
    workflow_step_id: step.id,
    status: 'pending',
  }));

  const data = await adminQuery(`
    mutation CreateStepRuns($objects: [step_runs_insert_input!]!) {
      insert_step_runs(objects: $objects) {
        returning {
          id
          workflow_step_id
          status
        }
      }
    }
  `, { objects });

  return data.insert_step_runs.returning;
}

/**
 * Update a step_run's status and optionally its output/error.
 */
export async function updateStepRun(stepRunId, updates) {
  const data = await adminQuery(`
    mutation UpdateStepRun($stepRunId: uuid!, $updates: step_runs_set_input!) {
      update_step_runs_by_pk(
        pk_columns: { id: $stepRunId },
        _set: $updates
      ) {
        id
        status
      }
    }
  `, { stepRunId, updates });

  return data.update_step_runs_by_pk;
}

/**
 * Update a workflow_run's status.
 */
export async function updateWorkflowRun(runId, updates) {
  const data = await adminQuery(`
    mutation UpdateRun($runId: uuid!, $updates: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(
        pk_columns: { id: $runId },
        _set: $updates
      ) {
        id
        status
      }
    }
  `, { runId, updates });

  return data.update_workflow_runs_by_pk;
}

/**
 * Increment the org's quota usage by 1.
 */
export async function incrementOrgQuota(orgId) {
  const data = await adminQuery(`
    mutation IncrementQuota($orgId: uuid!) {
      update_organizations_by_pk(
        pk_columns: { id: $orgId },
        _inc: { quota_used: 1 }
      ) {
        id
        quota_used
      }
    }
  `, { orgId });

  return data.update_organizations_by_pk;
}

/**
 * Insert a result into workflow_results (for db_write steps).
 */
export async function insertWorkflowResult(workflowRunId, orgId, resultType, resultData) {
  const data = await adminQuery(`
    mutation InsertResult($workflowRunId: uuid!, $orgId: uuid!, $resultType: String!, $data: jsonb!) {
      insert_workflow_results_one(object: {
        workflow_run_id: $workflowRunId,
        org_id: $orgId,
        result_type: $resultType,
        data: $data
      }) {
        id
      }
    }
  `, { workflowRunId, orgId, resultType, data: resultData });

  return data.insert_workflow_results_one;
}
