-- ============================================================
-- FlowPulse Workflow Automation — Initial Schema
-- ============================================================
-- This migration creates all core tables for the workflow 
-- automation platform with multi-tenant org isolation.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. ORGANIZATIONS
-- Central tenant table. Each org has its own usage quota.
-- ============================================================
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    -- Quota: max workflow runs allowed per billing period
    quota_limit INTEGER NOT NULL DEFAULT 100,
    -- Quota: how many runs have been used this period
    quota_used INTEGER NOT NULL DEFAULT 0,
    -- When the quota counter resets (start of next month)
    quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. ORG_MEMBERS
-- Junction table linking auth.users to organizations with a role.
-- A user can belong to multiple orgs with different roles.
-- ============================================================
CREATE TABLE public.org_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- References nhost's built-in auth.users table
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Role within this org: owner can do everything, editor can 
    -- create/edit workflows, viewer is read-only
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One role per user per org
    UNIQUE (org_id, user_id)
);

-- Index for fast lookup of "which orgs does this user belong to?"
CREATE INDEX idx_org_members_user_id ON public.org_members(user_id);
CREATE INDEX idx_org_members_org_id ON public.org_members(org_id);

-- ============================================================
-- 3. WORKFLOWS
-- A workflow belongs to an org and contains ordered steps.
-- ============================================================
CREATE TABLE public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflows_org_id ON public.workflows(org_id);

-- ============================================================
-- 4. WORKFLOW_STEPS
-- Ordered steps within a workflow. Each has a type and JSONB config.
-- Step types: llm_call, http_request, db_write, notify, 
--             conditional_branch, approval_gate
-- ============================================================
CREATE TABLE public.workflow_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'Untitled Step',
    -- The type determines which executor runs this step
    type TEXT NOT NULL CHECK (type IN (
        'llm_call', 
        'http_request', 
        'db_write', 
        'notify', 
        'conditional_branch', 
        'approval_gate'
    )),
    -- Step-specific configuration as JSON:
    -- llm_call: { "prompt": "...", "model": "llama-3.3-70b-versatile" }
    -- http_request: { "url": "...", "method": "GET", "headers": {}, "body": {} }
    -- db_write: { "table": "...", "data_template": {} }
    -- notify: { "topic": "...", "message_template": "..." }
    -- conditional_branch: { "condition": "...", "true_step": N, "false_step": N }
    -- approval_gate: { "message": "Awaiting approval..." }
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- No two steps in the same workflow can share an order number
    UNIQUE (workflow_id, step_order)
);

CREATE INDEX idx_workflow_steps_workflow_id ON public.workflow_steps(workflow_id);

-- ============================================================
-- 5. WORKFLOW_TRIGGERS
-- How a workflow can be started: manual, webhook, scheduled, 
-- or database_event.
-- ============================================================
CREATE TABLE public.workflow_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'manual', 
        'webhook', 
        'scheduled', 
        'database_event'
    )),
    -- Trigger-specific config:
    -- manual: {} (no config needed)
    -- webhook: { "secret": "..." }
    -- scheduled: { "cron": "*/5 * * * *" }
    -- database_event: { "watched_table": "...", "operation": "INSERT" }
    config JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_triggers_workflow_id ON public.workflow_triggers(workflow_id);

-- ============================================================
-- 6. WORKFLOW_RUNS
-- One record per execution of a workflow. Tracks overall status.
-- org_id is denormalized from workflows for faster permission checks.
-- ============================================================
CREATE TABLE public.workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    -- Denormalized from workflows for direct permission filtering
    -- without needing a join through workflows every time
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',   -- created, not yet started
        'running',   -- actively executing steps
        'paused',    -- hit an approval_gate, waiting
        'completed', -- all steps done successfully
        'failed'     -- a step failed after retries
    )),
    triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_runs_workflow_id ON public.workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_org_id ON public.workflow_runs(org_id);
CREATE INDEX idx_workflow_runs_status ON public.workflow_runs(status);

-- ============================================================
-- 7. STEP_RUNS
-- One record per step per run. Tracks individual step status,
-- input/output data, retry attempts, and approval info.
-- ============================================================
CREATE TABLE public.step_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
    workflow_step_id UUID NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',   -- not yet reached
        'running',   -- currently executing
        'completed', -- finished successfully
        'failed',    -- failed after all retries
        'skipped',   -- skipped by conditional_branch
        'paused'     -- approval_gate waiting for approval
    )),
    -- Input data passed to this step (usually previous step's output)
    input JSONB DEFAULT '{}',
    -- Output/result from this step
    output JSONB DEFAULT '{}',
    -- Error message if the step failed
    error TEXT,
    -- How many times this step has been attempted (for retry tracking)
    attempt_count INTEGER NOT NULL DEFAULT 0,
    -- For approval_gate steps: who approved and when
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_step_runs_workflow_run_id ON public.step_runs(workflow_run_id);
CREATE INDEX idx_step_runs_status ON public.step_runs(status);

-- ============================================================
-- 8. WORKFLOW_RESULTS (for db_write step to write into)
-- A generic table that db_write steps can insert data into.
-- ============================================================
CREATE TABLE public.workflow_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_run_id UUID REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    result_type TEXT NOT NULL DEFAULT 'general',
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_results_org_id ON public.workflow_results(org_id);

-- ============================================================
-- 9. AGGREGATION VIEW: org_monthly_usage
-- Computed view for org-level usage stats. Tracked as a Hasura
-- computed field / view so it's queryable via GraphQL.
-- ============================================================
CREATE OR REPLACE VIEW public.org_monthly_usage AS
SELECT 
    o.id AS org_id,
    o.name AS org_name,
    o.quota_limit,
    o.quota_used,
    o.quota_reset_at,
    COALESCE(COUNT(wr.id), 0)::INTEGER AS runs_this_month,
    COALESCE(
        AVG(
            EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at))
        ), 
        0
    )::NUMERIC(10,2) AS avg_run_duration_seconds
FROM public.organizations o
LEFT JOIN public.workflow_runs wr 
    ON wr.org_id = o.id 
    AND wr.created_at >= date_trunc('month', NOW())
GROUP BY o.id, o.name, o.quota_limit, o.quota_used, o.quota_reset_at;

-- ============================================================
-- 10. HELPER FUNCTION: Reset quota monthly
-- Can be called by a scheduled trigger to reset org quotas.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_org_quotas()
RETURNS void AS $$
BEGIN
    UPDATE public.organizations
    SET quota_used = 0,
        quota_reset_at = date_trunc('month', NOW()) + INTERVAL '1 month',
        updated_at = NOW()
    WHERE quota_reset_at <= NOW();
END;
$$ LANGUAGE plpgsql;
