/**
 * lib/graphql.js — GraphQL Operations
 * 
 * All GraphQL queries, mutations, and subscriptions used by the frontend.
 * Organized by feature area.
 */

import { gql } from '@apollo/client';

// ── Org & Membership ─────────────────────────────────────────

/** Get all orgs the current user belongs to, with their role */
export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members(order_by: { created_at: asc }) {
      id
      role
      organization {
        id
        name
        slug
        quota_limit
        quota_used
        quota_reset_at
      }
    }
  }
`;

/** Get members of a specific org */
export const GET_ORG_MEMBERS = gql`
  query GetOrgMembers($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }, order_by: { role: asc }) {
      id
      role
      user {
        id
        displayName
        email
      }
    }
  }
`;

// ── Workflows ────────────────────────────────────────────────

/** Get org's workflows with steps, triggers, and latest run */
export const GET_WORKFLOWS = gql`
  query GetWorkflows($orgId: uuid!) {
    workflows(
      where: { org_id: { _eq: $orgId } }
      order_by: { created_at: desc }
    ) {
      id
      name
      description
      is_active
      created_at
      updated_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        name
        type
        config
      }
      workflow_triggers {
        id
        type
        config
        is_active
      }
      workflow_runs(
        order_by: { created_at: desc }
        limit: 1
      ) {
        id
        status
        trigger_type
        created_at
        started_at
        completed_at
      }
    }
  }
`;

/** Get a single workflow with full details */
export const GET_WORKFLOW = gql`
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      is_active
      org_id
      created_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        step_order
        name
        type
        config
      }
      workflow_triggers {
        id
        type
        config
        is_active
      }
    }
  }
`;

/** Create a new workflow */
export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String) {
    insert_workflows_one(object: {
      org_id: $orgId,
      name: $name,
      description: $description
    }) {
      id
      name
    }
  }
`;

/** Update a workflow */
export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String, $isActive: Boolean!) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, is_active: $isActive, updated_at: "now()" }
    ) {
      id
      name
    }
  }
`;

/** Delete a workflow */
export const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

// ── Workflow Steps ───────────────────────────────────────────

/** Add a step to a workflow */
export const ADD_STEP = gql`
  mutation AddStep(
    $workflowId: uuid!
    $stepOrder: Int!
    $name: String!
    $type: String!
    $config: jsonb!
  ) {
    insert_workflow_steps_one(object: {
      workflow_id: $workflowId,
      step_order: $stepOrder,
      name: $name,
      type: $type,
      config: $config
    }) {
      id
      step_order
      name
      type
    }
  }
`;

/** Update a step */
export const UPDATE_STEP = gql`
  mutation UpdateStep($id: uuid!, $name: String!, $type: String!, $config: jsonb!) {
    update_workflow_steps_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, type: $type, config: $config }
    ) {
      id
    }
  }
`;

/** Delete a step */
export const DELETE_STEP = gql`
  mutation DeleteStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

// ── Triggers ─────────────────────────────────────────────────

/** Add a trigger to a workflow */
export const ADD_TRIGGER = gql`
  mutation AddTrigger($workflowId: uuid!, $type: String!, $config: jsonb!) {
    insert_workflow_triggers_one(object: {
      workflow_id: $workflowId,
      type: $type,
      config: $config
    }) {
      id
      type
    }
  }
`;

/** Delete a trigger */
export const DELETE_TRIGGER = gql`
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

// ── Workflow Runs ────────────────────────────────────────────

/** Get runs for a workflow */
export const GET_WORKFLOW_RUNS = gql`
  query GetWorkflowRuns($workflowId: uuid!) {
    workflow_runs(
      where: { workflow_id: { _eq: $workflowId } }
      order_by: { created_at: desc }
      limit: 20
    ) {
      id
      status
      trigger_type
      started_at
      completed_at
      created_at
      step_runs(order_by: { workflow_step: { step_order: asc } }) {
        id
        status
        attempt_count
        error
        started_at
        completed_at
        workflow_step {
          name
          type
          step_order
        }
      }
    }
  }
`;

/** Trigger a workflow run (calls the Hasura Action) */
export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      workflow_run_id
      message
    }
  }
`;

/** Approve a paused step (calls the Hasura Action) */
export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      success
      message
    }
  }
`;

// ── Subscriptions ────────────────────────────────────────────

/**
 * Subscribe to step_runs for a specific workflow_run.
 * This is what makes the "no page refresh" requirement work.
 * 
 * WHAT A SUBSCRIPTION IS: Unlike a query (which runs once and returns),
 * a subscription keeps a WebSocket connection open and Hasura pushes
 * updated data to the client every time the underlying data changes.
 * When our Action handler updates a step_run status, this subscription
 * automatically delivers the new status to the frontend.
 */
export const SUBSCRIBE_STEP_RUNS = gql`
  subscription SubscribeStepRuns($workflowRunId: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $workflowRunId } }
      order_by: { workflow_step: { step_order: asc } }
    ) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
      workflow_step {
        id
        name
        type
        step_order
        config
      }
    }
  }
`;

/** Subscribe to a workflow run's overall status */
export const SUBSCRIBE_WORKFLOW_RUN = gql`
  subscription SubscribeWorkflowRun($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      started_at
      completed_at
    }
  }
`;
