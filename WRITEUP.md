# WRITEUP — Schema Reasoning & Permission Architecture

## Schema Design

### Why These Tables

The schema follows a strict ownership hierarchy: **organization → workflows → steps/triggers** and **organization → workflow_runs → step_runs**. This hierarchy is the foundation of the permission model — every piece of data has a clear path back to an organization, which is how we enforce isolation.

| Table | Why It Exists |
|-------|--------------|
| `organizations` | The tenant boundary. Every piece of data belongs to exactly one org. Quota tracking (quota_limit, quota_used) lives here because quotas are org-level policy. |
| `org_members` | Junction table with a role column. A user can belong to multiple orgs with different roles. The UNIQUE constraint on (org_id, user_id) prevents duplicate memberships. |
| `workflows` | Belongs to an org. Has `created_by` for audit trail but ownership is at the org level, not the user level. |
| `workflow_steps` | Ordered via `step_order` with a UNIQUE constraint on (workflow_id, step_order) to prevent ordering conflicts. `config` is JSONB because different step types need different configuration shapes. |
| `workflow_triggers` | Separated from workflows because a workflow can have multiple trigger types simultaneously (e.g., both manual and webhook). |
| `workflow_runs` | One record per execution. `org_id` is denormalized from `workflows` — this avoids an extra JOIN in every permission check on runs. `status` supports 'paused' for approval gates. |
| `step_runs` | One per step per run. Tracks `attempt_count` for retry visibility, `approved_by`/`approved_at` for audit trail on approval gates. |
| `workflow_results` | Target table for `db_write` steps. Org-scoped so isolation extends to results too. |
| `org_monthly_usage` (VIEW) | Aggregation computed at query time, not stored. Calculates runs this month and average duration. Tracked by Hasura as a read-only table for GraphQL access. |

### Key Design Decisions

1. **Denormalized `org_id` on `workflow_runs`**: Normally you'd traverse `workflow_runs.workflow_id → workflows.org_id`. But permission checks happen on every query, and adding a JOIN slows things down. The denormalized `org_id` lets Hasura check permissions with a direct column comparison.

2. **JSONB for config**: Step types have wildly different configurations. An `llm_call` needs a prompt and model name; an `http_request` needs a URL and method; a `conditional_branch` needs a condition expression. JSONB accommodates all of these without schema changes.

3. **Separate `step_runs` from `workflow_steps`**: Steps are the *definition* (what to do), step_runs are the *execution* (what happened). One step definition produces many step_runs across different workflow runs.

---

## Two Permission Layers — How They're Different

### Layer 1: Hasura Row-Level Permissions (enforced by the database engine)

**Where**: `nhost/metadata/databases/default/tables/*.yaml`

**Mechanism**: Every table has `select_permissions`, `insert_permissions`, `update_permissions`, and `delete_permissions` that include a `filter` or `check` clause. These filters traverse the relationship chain back to `org_members` to verify the requesting user is a member of the data's organization.

**Example** (from `public_step_runs.yaml`):
```yaml
select_permissions:
  - role: user
    permission:
      filter:
        workflow_run:          # step_run → workflow_run
          organization:        # workflow_run → organization
            org_members:       # organization → org_members
              user_id:
                _eq: X-Hasura-User-Id
```

This chain means: "You can SELECT this step_run only if you are a member of the organization that owns the workflow_run that owns this step_run."

**What it catches**: An Org B user (`owner_b@demo.com`) who tries to query `workflows_by_pk(id: "<org-a-workflow-id>")` will get `null` back — Hasura's permission filter runs as a WHERE clause in the SQL query, and since the user isn't in Org A's `org_members`, no rows match.

**What it can't catch**: Value-based restrictions. For example, there's no way to write a Hasura permission that says "you can insert a workflow_step, but only if the `type` column isn't `db_write`." Hasura permissions operate on WHO accesses WHICH rows, not on the VALUES being written.

### Layer 2: Handler Code Checks (enforced in serverless functions)

**Where**: `functions/trigger-workflow-run.js` and `functions/approve-step.js`

**Mechanism**: The Action handler receives the caller's `x-hasura-user-id` from Hasura's session variables. It then queries `org_members` to get the user's role, and makes authorization decisions in code.

**What it catches** (with specific file/line references):

1. **Role-based run blocking** (`trigger-workflow-run.js`):
   - Viewers cannot trigger runs → `membership.role === 'viewer'` check
   - This could theoretically be a Hasura permission on the Action, but we check it here too for defense-in-depth

2. **Step-type restrictions** (`trigger-workflow-run.js`):
   - Only owners can run workflows containing `db_write` or `notify` steps
   - **Why not Hasura**: Hasura can check if you're an owner before letting you INSERT a step, but can't check what steps ALREADY EXIST in a workflow when you try to RUN it. The restriction is "don't run a workflow that has dangerous steps unless you're an owner" — that requires reading the steps at runtime and making a decision.

3. **Quota enforcement** (`trigger-workflow-run.js`):
   - Checks `org.quota_used >= org.quota_limit` before allowing a run
   - **Why not Hasura**: Hasura permissions can't do cross-table numeric comparisons. There's no way to say "allow INSERT on workflow_runs only if organizations.quota_used < organizations.quota_limit."

4. **Approval role check** (`approve-step.js`):
   - Only owners/editors can approve paused steps
   - **Why not Hasura**: Approving a step isn't just an UPDATE — it triggers resumption of the workflow execution. A Hasura update permission could let you set `approved_by`, but can't also cause the remaining steps to execute. The approval is a business logic decision with side effects.

---

## Approval Gate Implementation

### How Pause Works

1. The workflow engine (`trigger-workflow-run.js`) executes steps sequentially
2. When it reaches a step with `type: 'approval_gate'`:
   - The step executor returns `{ pause: true }`
   - The handler sets `step_run.status = 'paused'`
   - The handler sets `workflow_run.status = 'paused'`
   - **Execution stops** — the function returns (or in the async case, the step loop breaks)
3. The subscription immediately pushes the 'paused' status to the frontend
4. The frontend shows the approval UI for owners/editors

### How Resume Works

1. An owner/editor clicks "Approve" → calls the `approveStep` mutation
2. `approve-step.js` handler:
   - Verifies the step is actually in 'paused' status
   - Verifies the step type is 'approval_gate' (not just any step)
   - **Layer 2 check**: Verifies the caller is owner/editor in the step's org
   - Sets `step_run.status = 'completed'`, records `approved_by` and `approved_at`
   - Sets `workflow_run.status = 'running'`
   - Calls `executeStepsFromIndex()` with the next step index to resume execution
3. The remaining steps execute and the subscription updates the frontend in real-time

### Why This Design

The approval gate is fundamentally a **two-phase execution**: pause (triggered during step execution) and resume (triggered by a separate user action). This can't be a simple database trigger because:
- The pause needs to stop a running process (the step execution loop)
- The resume needs to start a new process (continuing from where it left off)
- The authorization check for resume is different from the original runner (different user, different time)
