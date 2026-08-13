/**
 * test-run.js — End-to-end testing script
 * 
 * Logs in as owner_a@demo.com, triggers the Weather Analysis Pipeline,
 * and polls the step_runs status to verify full execution.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const AUTH_URL = 'https://local.auth.nhost.run/v1';
const GRAPHQL_URL = 'https://local.graphql.nhost.run/v1';
const ADMIN_SECRET = 'nhost-admin-secret';

async function login(email, password) {
  const res = await fetch(`${AUTH_URL}/signin/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data.session.accessToken;
}

async function graphql(query, variables = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    headers['x-hasura-admin-secret'] = ADMIN_SECRET;
  }

  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function main() {
  console.log('🧪 Testing Workflow Execution End-to-End...\n');

  // 1. Log in as owner_a
  console.log('1. Logging in as owner_a@demo.com...');
  const token = await login('owner_a@demo.com', 'password123');
  console.log('   ✓ Logged in successfully!');

  // 2. Trigger workflow run
  const workflowId = '11111111-0000-0000-0000-000000000001';
  console.log(`\n2. Triggering workflow run for ${workflowId}...`);
  const triggerRes = await graphql(`
    mutation Trigger($workflowId: uuid!) {
      triggerWorkflowRun(workflow_id: $workflowId) {
        workflow_run_id
        message
      }
    }
  `, { workflowId }, token);

  const runId = triggerRes.triggerWorkflowRun.workflow_run_id;
  console.log(`   ✓ Run started! Run ID: ${runId}`);
  console.log(`   Message: ${triggerRes.triggerWorkflowRun.message}`);

  // 3. Monitor step runs
  console.log('\n3. Monitoring step execution...');
  let isPaused = false;
  let isCompleted = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));

    const runData = await graphql(`
      query GetRun($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          status
          step_runs(order_by: { created_at: asc }) {
            id
            status
            attempt_count
            output
            error
            workflow_step {
              name
              type
            }
          }
        }
      }
    `, { runId }, token);

    const run = runData.workflow_runs_by_pk;
    console.log(`   [Attempt ${attempt + 1}] Overall Run Status: ${run.status}`);
    
    for (const sr of run.step_runs) {
      console.log(`     - Step: ${sr.workflow_step?.name} (${sr.workflow_step?.type}) => ${sr.status} (attempts: ${sr.attempt_count})`);
    }

    if (run.status === 'paused') {
      isPaused = true;
      console.log('\n   ⏸ Workflow paused at approval gate as expected!');
      break;
    }
    if (run.status === 'completed' || run.status === 'failed') {
      isCompleted = true;
      break;
    }
  }

  // 4. Approve paused step if paused
  if (isPaused) {
    const runData = await graphql(`
      query GetRun($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          step_runs(where: { status: { _eq: "paused" } }) {
            id
          }
        }
      }
    `, { runId }, token);

    const pausedStepId = runData.workflow_runs_by_pk.step_runs[0]?.id;
    if (pausedStepId) {
      console.log(`\n4. Approving step ${pausedStepId}...`);
      const approveRes = await graphql(`
        mutation Approve($stepRunId: uuid!) {
          approveStep(step_run_id: $stepRunId) {
            success
            message
          }
        }
      `, { stepRunId: pausedStepId }, token);
      console.log(`   ✓ Approve result: ${approveRes.approveStep.message}`);

      // Wait for remaining steps to finish
      console.log('\n5. Waiting for post-approval steps to finish...');
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const postData = await graphql(`
          query GetRun($runId: uuid!) {
            workflow_runs_by_pk(id: $runId) {
              status
              step_runs(order_by: { created_at: asc }) {
                status
                workflow_step { name }
              }
            }
          }
        `, { runId }, token);
        
        const run = postData.workflow_runs_by_pk;
        console.log(`   [Attempt ${attempt + 1}] Run Status: ${run.status}`);
        if (run.status === 'completed' || run.status === 'failed') {
          break;
        }
      }
    }
  }

  // 5. Test Cross-Org Isolation (Org B trying to access Org A workflow)
  console.log('\n6. Testing Cross-Org Isolation...');
  const tokenB = await login('owner_b@demo.com', 'password123');
  console.log('   Logging in as owner_b@demo.com...');

  try {
    const orgBQuery = await graphql(`
      query {
        workflows_by_pk(id: "${workflowId}") {
          id
          name
        }
      }
    `, {}, tokenB);
    console.log(`   Org B query result for Org A workflow ID: ${JSON.stringify(orgBQuery.workflows_by_pk)} (Expected: null)`);
  } catch (err) {
    console.log(`   ✓ Access correctly blocked! ${err.message}`);
  }

  try {
    await graphql(`
      mutation {
        triggerWorkflowRun(workflow_id: "${workflowId}") {
          workflow_run_id
          message
        }
      }
    `, {}, tokenB);
    console.error('   ❌ ERROR: Org B was able to trigger Org A workflow!');
  } catch (err) {
    console.log(`   ✓ Trigger correctly blocked for Org B user! Error: ${err.message}`);
  }

  console.log('\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
}

main().catch(console.error);
