/**
 * _utils/step-executors.js — Step Type Executors
 * 
 * Each step type has its own executor function that handles the actual
 * business logic: calling external APIs, evaluating conditions, etc.
 * 
 * RETRY LOGIC: llm_call and http_request steps include exponential
 * backoff retry (max 3 attempts). The attempt_count is recorded in
 * the step_run record for visibility.
 * 
 * LAYER 2 NOTE: Step-type permission gating (e.g., only owners can 
 * add db_write or notify steps) is checked BEFORE execution in the 
 * main handler, not in these executors. These just run the step.
 */

import Groq from 'groq-sdk';
import { insertWorkflowResult } from './graphql.js';

// ── Retry Helper ─────────────────────────────────────────────
/**
 * Retries an async function with exponential backoff.
 * @param {Function} fn - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts (default: 3)
 * @param {number} baseDelay - Base delay in ms (default: 1000)
 * @returns {{ result: any, attempts: number }}
 */
async function withRetry(fn, maxAttempts = 3, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt}/${maxAttempts} failed:`, error.message);
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw { error: lastError, attempts: maxAttempts };
}

// ── LLM Call Executor ────────────────────────────────────────
/**
 * Calls the Groq API with a prompt. The prompt can include 
 * {{previous_output}} which gets replaced with the previous step's output.
 * 
 * Uses Groq's free tier with open-weight models (Llama 3.3).
 * Groq's API service is proprietary, but the models are open source.
 */
export async function executeLlmCall(config, previousOutput) {
  const apiKey = process.env.GROQ_API_KEY;
  
  if (!apiKey) {
    // Stubbed mode: if no API key, return a mock response
    // This is disclosed in the README as a fallback
    console.warn('GROQ_API_KEY not set — using stubbed LLM response');
    await new Promise(resolve => setTimeout(resolve, 1500)); // Artificial delay
    return {
      result: {
        classification: 'NORMAL',
        summary: 'Stubbed LLM response (GROQ_API_KEY not configured)',
        recommendation: 'Set GROQ_API_KEY environment variable for real LLM calls',
      },
      attempts: 1,
      stubbed: true,
    };
  }

  // Interpolate {{previous_output}} in the prompt
  let prompt = config.prompt || 'Analyze this data: {{previous_output}}';
  prompt = prompt.replace(
    /\{\{previous_output\}\}/g, 
    JSON.stringify(previousOutput)
  );

  const model = config.model || 'llama-3.3-70b-versatile';

  const { result, attempts } = await withRetry(async () => {
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant. Always respond with valid JSON when asked for structured output.' 
        },
        { role: 'user', content: prompt }
      ],
      model,
      temperature: 0.3,
      max_tokens: 1024,
    });

    const content = completion.choices[0]?.message?.content || '';
    
    // Try to parse as JSON, fall back to raw text
    try {
      return JSON.parse(content);
    } catch {
      // If it looks like JSON wrapped in markdown code blocks, extract it
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1].trim());
      }
      return { raw_response: content };
    }
  });

  return { result, attempts };
}

// ── HTTP Request Executor ────────────────────────────────────
/**
 * Makes a generic HTTP request to any external API.
 * Demo uses Open-Meteo (fully free, no API key, open source project).
 */
export async function executeHttpRequest(config, previousOutput) {
  let url = config.url;
  const method = (config.method || 'GET').toUpperCase();
  const headers = config.headers || {};
  let body = config.body || null;

  // Interpolate {{previous_output}} in URL and body
  if (url) {
    url = url.replace(/\{\{previous_output\}\}/g, JSON.stringify(previousOutput));
  }
  if (body && typeof body === 'string') {
    body = body.replace(/\{\{previous_output\}\}/g, JSON.stringify(previousOutput));
  }

  const { result, attempts } = await withRetry(async () => {
    const fetchOptions = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    if (method !== 'GET' && method !== 'HEAD' && body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return { text: await response.text() };
  });

  return { result, attempts };
}

// ── DB Write Executor ────────────────────────────────────────
/**
 * Writes data into the workflow_results table.
 * 
 * LAYER 2 RESTRICTION: Only owners can add db_write steps to a workflow.
 * This is checked in the main handler before execution reaches here.
 * WHY IN CODE: Hasura row-level permissions can restrict WHO inserts,
 * but can't restrict inserts based on the step TYPE column value.
 * The decision "is this a db_write step?" requires runtime inspection
 * of the step's type field, which isn't expressible as a Hasura filter.
 */
export async function executeDbWrite(config, previousOutput, context) {
  const resultType = config.result_type || 'workflow_output';
  const dataTemplate = config.data_template || {};
  
  // Merge template with previous output
  const data = {
    ...dataTemplate,
    step_output: previousOutput,
    written_at: new Date().toISOString(),
  };

  const inserted = await insertWorkflowResult(
    context.workflowRunId,
    context.orgId,
    resultType,
    data
  );

  return { result: { inserted_id: inserted.id, result_type: resultType }, attempts: 1 };
}

// ── Conditional Branch Executor ──────────────────────────────
/**
 * Evaluates a condition against the previous step's output.
 * Returns { branch_taken: true/false, label: "..." }
 * 
 * The main handler uses the branch_taken value to decide whether
 * to skip remaining steps or continue.
 */
export async function executeConditionalBranch(config, previousOutput) {
  const condition = config.condition || 'true';
  const trueLabel = config.true_label || 'Condition met';
  const falseLabel = config.false_label || 'Condition not met';

  let branchTaken = false;
  
  try {
    // Safely evaluate the condition with the output in scope
    // We use a simple approach: check if the output contains certain values
    const output = previousOutput;
    
    if (condition.includes('===')) {
      // Simple equality check: "output.classification === 'SEVERE'"
      const parts = condition.split('===').map(p => p.trim());
      const fieldPath = parts[0].replace('output.', '');
      const expectedValue = parts[1].replace(/['"]/g, '');
      
      // Navigate the field path
      let value = output;
      for (const key of fieldPath.split('.')) {
        value = value?.[key];
      }
      
      branchTaken = String(value) === expectedValue;
    } else if (condition.includes('includes')) {
      // String includes check
      branchTaken = JSON.stringify(output).toLowerCase().includes(
        condition.match(/includes\(['"](.+)['"]\)/)?.[1]?.toLowerCase() || ''
      );
    } else {
      // Default: treat as truthy check on previous output
      branchTaken = !!output;
    }
  } catch (error) {
    console.error('Condition evaluation error:', error.message);
    branchTaken = false;
  }

  return {
    result: {
      branch_taken: branchTaken,
      label: branchTaken ? trueLabel : falseLabel,
      condition_evaluated: condition,
    },
    attempts: 1,
  };
}

// ── Notify Executor ──────────────────────────────────────────
/**
 * Sends a push notification via ntfy.sh.
 * ntfy.sh is open source (self-hostable) and the public instance
 * needs no signup — just publish to a topic.
 * 
 * LAYER 2 RESTRICTION: Only owners can add notify steps.
 * Same reasoning as db_write — can't express step-type restrictions
 * in Hasura row-level permissions.
 */
export async function executeNotify(config, previousOutput) {
  const topic = config.topic || 'flowpulse-demo';
  const title = config.title || 'FlowPulse Notification';
  let message = config.message_template || 'Workflow step completed: {{previous_output}}';
  
  // Interpolate previous output
  message = message.replace(
    /\{\{previous_output\}\}/g,
    typeof previousOutput === 'string' 
      ? previousOutput 
      : JSON.stringify(previousOutput, null, 2)
  );

  // Truncate very long messages
  if (message.length > 2000) {
    message = message.substring(0, 1997) + '...';
  }

  try {
    const response = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': 'default',
        'Tags': 'robot',
      },
      body: message,
    });

    if (!response.ok) {
      throw new Error(`ntfy.sh returned ${response.status}`);
    }

    return {
      result: {
        notified: true,
        topic,
        title,
        message_preview: message.substring(0, 200),
      },
      attempts: 1,
    };
  } catch (error) {
    console.error('Notify failed:', error.message);
    // Don't fail the whole workflow for a notification failure
    return {
      result: {
        notified: false,
        error: error.message,
        topic,
      },
      attempts: 1,
    };
  }
}

// ── Approval Gate Executor ───────────────────────────────────
/**
 * This doesn't "execute" anything — it signals that the run should
 * pause. The main handler checks the return value and sets the 
 * step/run to 'paused' status.
 */
export async function executeApprovalGate(config) {
  return {
    result: {
      requires_approval: true,
      message: config.message || 'Awaiting approval to continue.',
    },
    attempts: 1,
    pause: true, // Signal to the handler to pause the run
  };
}
