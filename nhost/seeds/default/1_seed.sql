-- ============================================================
-- SEED DATA: Two demo organizations with users
-- ============================================================
-- This seed creates:
-- • Org A ("Acme Corp") with owner_a, editor_a, viewer_a
-- • Org B ("Beta Inc") with owner_b, editor_b, viewer_b
-- • A demo workflow in Org A with 5 step types
-- • Triggers for the demo workflow (manual + webhook)
--
-- NOTE: Users are created via nhost Auth API (not raw SQL),
-- so this seed only handles the org/workflow data.
-- User creation is done by the seed script (seed-users.js).
-- ============================================================

-- Insert Organizations
INSERT INTO public.organizations (id, name, slug, quota_limit, quota_used) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Acme Corp', 'acme-corp', 50, 0),
    ('b0000000-0000-0000-0000-000000000002', 'Beta Inc', 'beta-inc', 50, 0)
ON CONFLICT (id) DO NOTHING;

-- Demo workflow in Org A
INSERT INTO public.workflows (id, org_id, name, description, is_active) VALUES
    ('11111111-0000-0000-0000-000000000001', 
     'a0000000-0000-0000-0000-000000000001',
     'Weather Analysis Pipeline',
     'Fetches weather data, analyzes it with AI, branches on severity, requires approval, then notifies.',
     true)
ON CONFLICT (id) DO NOTHING;

-- Demo workflow steps (5 steps covering required types)
INSERT INTO public.workflow_steps (id, workflow_id, step_order, name, type, config) VALUES
    -- Step 1: Fetch current weather from Open-Meteo
    ('22222222-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000001',
     1,
     'Fetch Weather Data',
     'http_request',
     '{"url": "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,wind_speed_10m,weather_code&timezone=America/New_York", "method": "GET"}'::jsonb),

    -- Step 2: Ask LLM to analyze the weather data
    ('22222222-0000-0000-0000-000000000002',
     '11111111-0000-0000-0000-000000000001',
     2,
     'AI Weather Analysis',
     'llm_call',
     '{"prompt": "Analyze this weather data and classify the conditions as either SEVERE or NORMAL. Respond with a JSON object containing: {\"classification\": \"SEVERE\" or \"NORMAL\", \"summary\": \"brief description\", \"recommendation\": \"what to do\"}. Weather data: {{previous_output}}", "model": "llama-3.3-70b-versatile"}'::jsonb),

    -- Step 3: Branch based on LLM classification
    ('22222222-0000-0000-0000-000000000003',
     '11111111-0000-0000-0000-000000000001',
     3,
     'Severity Check',
     'conditional_branch',
     '{"condition": "output.classification === ''SEVERE''", "true_label": "Weather is severe - needs approval", "false_label": "Weather is normal - auto-approve"}'::jsonb),

    -- Step 4: Approval gate
    ('22222222-0000-0000-0000-000000000004',
     '11111111-0000-0000-0000-000000000001',
     4,
     'Manager Approval',
     'approval_gate',
     '{"message": "Weather analysis complete. Please review the AI assessment and approve to send notification."}'::jsonb),

    -- Step 5: Send notification via ntfy.sh
    ('22222222-0000-0000-0000-000000000005',
     '11111111-0000-0000-0000-000000000001',
     5,
     'Send Alert',
     'notify',
     '{"topic": "flowpulse-demo", "message_template": "Weather Alert: {{previous_output}}", "title": "FlowPulse Weather Pipeline"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Triggers for the demo workflow
INSERT INTO public.workflow_triggers (id, workflow_id, type, config, is_active) VALUES
    ('33333333-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000001',
     'manual',
     '{}'::jsonb,
     true),
    ('33333333-0000-0000-0000-000000000002',
     '11111111-0000-0000-0000-000000000001',
     'webhook',
     '{"secret": "demo-webhook-secret-123"}'::jsonb,
     true)
ON CONFLICT (id) DO NOTHING;

-- A second workflow in Org B
INSERT INTO public.workflows (id, org_id, name, description, is_active) VALUES
    ('11111111-0000-0000-0000-000000000002',
     'b0000000-0000-0000-0000-000000000002',
     'Beta Simple Workflow',
     'A simple workflow in Org B for testing cross-org isolation.',
     true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workflow_steps (id, workflow_id, step_order, name, type, config) VALUES
    ('22222222-0000-0000-0000-000000000010',
     '11111111-0000-0000-0000-000000000002',
     1,
     'Beta HTTP Step',
     'http_request',
     '{"url": "https://api.open-meteo.com/v1/forecast?latitude=51.51&longitude=-0.13&current=temperature_2m", "method": "GET"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workflow_triggers (id, workflow_id, type, config, is_active) VALUES
    ('33333333-0000-0000-0000-000000000010',
     '11111111-0000-0000-0000-000000000002',
     'manual',
     '{}'::jsonb,
     true)
ON CONFLICT (id) DO NOTHING;
