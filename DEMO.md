# DEMO — Final Task Walkthrough Script

This script walks through the 6 required proof points of the Final Task. Follow these steps in order while recording your screen.

---

## Prerequisites

Before starting:
- [ ] `nhost up` is running (if paused on cloud, resume it first)
- [ ] `node functions/seed-users.js` has been run (users exist)
- [ ] Frontend dev server is running (`cd frontend && npm run dev`)
- [ ] (Optional) `GROQ_API_KEY` is set in `.secrets` for real LLM calls

---

## Proof Point 1: Two Separate Organizations Exist

1. **Open** http://localhost:3000
2. **Log in** as `owner_a@demo.com` / `password123`
3. **Show** the org selector in the navbar — it shows "Acme Corp (owner)"
4. **Log out**, then **log in** as `owner_b@demo.com` / `password123`
5. **Show** the org selector — it shows "Beta Inc (owner)"
6. **Narrate**: "Two separate organizations exist, each with their own users and roles."

---

## Proof Point 2: Build a Workflow with Required Step Types

1. **Log in** as `owner_a@demo.com`
2. **Navigate** to "Acme Corp" dashboard
3. **Show** the pre-built "Weather Analysis Pipeline" workflow
4. **Click** into it to show the steps:
   - Step 1: `http_request` (Fetch Weather Data from Open-Meteo)
   - Step 2: `llm_call` (AI Weather Analysis via Groq)
   - Step 3: `conditional_branch` (Severity Check — branches on LLM output)
   - Step 4: `approval_gate` (Manager Approval)
   - Step 5: `notify` (Send Alert via ntfy.sh)
5. **Narrate**: "This workflow has all required step types: http_request, llm_call, conditional_branch that changes behavior based on LLM output, and an approval_gate."

---

## Proof Point 3: Start the Workflow Two Ways

### Way 1: Manual trigger
1. On the workflow detail page, **click** "▶ Run Workflow"
2. You'll be redirected to the run viewer page
3. **Wait** for execution to reach the approval gate (it will pause)
4. **Narrate**: "The workflow was started manually."

### Way 2: Webhook trigger
1. **Open a terminal** and run:
   ```bash
    curl -k -X POST https://local.graphql.local.nhost.run/v1 \
      -H "Content-Type: application/json" \
      -H "x-hasura-admin-secret: nhost-admin-secret" \
      -H "x-hasura-role: user" \
      -d '{
        "query": "mutation { webhookTrigger(workflow_id: \"11111111-0000-0000-0000-000000000001\", webhook_secret: \"demo-webhook-secret-123\") { workflow_run_id message } }"
      }'
   ```
2. **Show** the response contains a `workflow_run_id`
3. **Go back** to the workflow detail page and **show** the new run in "Recent Runs"
4. **Narrate**: "The same workflow was also started via webhook — no button click needed."

---

## Proof Point 4: Approval Gate Pauses and Requires Approval

1. **Open** the manually-triggered run from Proof Point 3 (the one that's paused)
2. **Show** the run status is "paused"
3. **Show** the approval gate step has status "paused" with the message "Please review..."
4. **Show** the "✓ Approve & Continue" button
5. **Click** the approve button
6. **Watch** the remaining steps execute in real-time (the notify step)
7. **Narrate**: "The run paused at the approval gate. As an owner, I approved it, and execution resumed."

---

## Proof Point 5: Live Status Streams Step-by-Step

1. **Trigger** another run (click "▶ Run Workflow" on the workflow detail page)
2. **On the run viewer page**, show each step transitioning:
   - Step 1: pending → running → completed
   - Step 2: pending → running → completed
   - Step 3: pending → running → completed
   - Step 4: pending → running → paused
3. **Narrate**: "Status updates stream in real-time via GraphQL subscription — no page refresh at any point. You can see the spinner on running steps, the output appearing, and the pause indicator."
4. **Point out** the attempt count on any step (visible if > 1)

---

## Proof Point 6: Cross-Org Isolation

### 6a: UI-level isolation
1. **Log out** of owner_a@demo.com
2. **Log in** as `owner_b@demo.com` / `password123`
3. **Show** the dashboard — it shows "Beta Inc" workflows only
4. **Narrate**: "Logged in as Org B owner. I can only see Beta Inc's workflows."

### 6b: Direct ID guessing (the real test)
1. **Open** the Hasura console or a GraphQL client
2. **With Org B's auth token**, try to query Org A's workflow by its known ID:
   ```graphql
   query {
     workflows_by_pk(id: "11111111-0000-0000-0000-000000000001") {
       id
       name
       org_id
     }
   }
   ```
3. **Show** the response is `null` — Org B user cannot see Org A's data even with the exact ID

### 6c: Try to trigger Org A's workflow as Org B user
1. **Still logged in as Org B user**, try to trigger Org A's workflow:
   ```graphql
   mutation {
     triggerWorkflowRun(workflow_id: "w0000000-0000-0000-0000-000000000001") {
       workflow_run_id
       message
     }
   }
   ```
2. **Show** the error: "Access denied: you are not a member of this organization"
3. **Narrate**: "Even with the exact workflow ID, a user from another organization cannot see, trigger, or approve anything — the permission check happens at both the Hasura layer and the handler layer."

### 6d: Try to approve Org A's paused step as Org B user
1. If there's a paused run in Org A, try approving it:
   ```graphql
   mutation {
     approveStep(step_run_id: "<org-a-step-run-id>") {
       success
       message
     }
   }
   ```
2. **Show** the error: "Access denied: you are not a member of this organization"

---

## Summary Narration

"To summarize what we've demonstrated:
1. Two orgs exist with separate users and roles
2. A workflow with http_request, llm_call, conditional_branch, and approval_gate steps
3. The workflow starts both manually and via webhook
4. The approval gate pauses execution until an owner approves
5. Live status streams step-by-step with no page refresh
6. Cross-org isolation is enforced at both the database and handler level — even direct ID guessing fails."
