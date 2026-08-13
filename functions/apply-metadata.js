/**
 * apply-metadata.js — Applies Hasura metadata via the metadata API
 * 
 * This script reads our metadata configuration and sends them to
 * the Hasura metadata API calls using docker exec.
 * 
 * Run: node functions/apply-metadata.js
 */

import { execSync } from 'child_process';

function getTraefikContainer() {
  try {
    const ps = execSync("docker ps --format '{{.Names}}' | grep traefik", { encoding: 'utf-8' }).trim();
    if (ps) return ps.split('\n')[0];
  } catch(e) {}
  return 'flowpulse-traefik-1';
}

function hasuraMetadataAPI(body) {
  const json = JSON.stringify(body).replace(/'/g, "'\\''");
  const container = getTraefikContainer();
  const cmd = `docker exec ${container} wget -qO- http://graphql:8080/v1/metadata --post-data='${json}' --header='x-hasura-admin-secret: nhost-admin-secret' --header='Content-Type: application/json'`;
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
    return JSON.parse(result || '{}');
  } catch (err) {
    if (err.stdout) {
      try { return JSON.parse(err.stdout); } catch(e) {}
    }
    return { error: err.message };
  }
}

async function main() {
  console.log('=== Applying Hasura Metadata ===\n');

  // 1. Track all public tables
  const tables = [
    'organizations', 'org_members', 'workflows', 'workflow_steps',
    'workflow_triggers', 'workflow_runs', 'step_runs', 'workflow_results',
    'org_monthly_usage'
  ];

  for (const table of tables) {
    console.log(`Tracking table: ${table}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_track_table',
      args: {
        source: 'default',
        table: { schema: 'public', name: table }
      }
    });
    if (res.error && !res.error.includes('already tracked')) {
      console.log(`  Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`  ✅ Tracked`);
    }
  }

  // 2. Create relationships
  console.log('\n--- Creating Object Relationships ---');

  const objRels = [
    { table: 'org_members', name: 'organization', column: 'org_id' },
    { table: 'org_members', name: 'user', column: 'user_id' },
    { table: 'workflows', name: 'organization', column: 'org_id' },
    { table: 'workflows', name: 'creator', column: 'created_by' },
    { table: 'workflow_steps', name: 'workflow', column: 'workflow_id' },
    { table: 'workflow_triggers', name: 'workflow', column: 'workflow_id' },
    { table: 'workflow_runs', name: 'workflow', column: 'workflow_id' },
    { table: 'workflow_runs', name: 'organization', column: 'org_id' },
    { table: 'workflow_runs', name: 'triggered_by_user', column: 'triggered_by' },
    { table: 'step_runs', name: 'workflow_run', column: 'workflow_run_id' },
    { table: 'step_runs', name: 'workflow_step', column: 'workflow_step_id' },
    { table: 'step_runs', name: 'approver', column: 'approved_by' },
    { table: 'workflow_results', name: 'workflow_run', column: 'workflow_run_id' },
    { table: 'workflow_results', name: 'organization', column: 'org_id' },
  ];

  for (const rel of objRels) {
    console.log(`  ${rel.table}.${rel.name}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: rel.table },
        name: rel.name,
        using: { foreign_key_constraint_on: rel.column }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  console.log('\n--- Creating Array Relationships ---');

  const arrRels = [
    { table: 'organizations', name: 'org_members', column: 'org_id', refTable: 'org_members' },
    { table: 'organizations', name: 'workflows', column: 'org_id', refTable: 'workflows' },
    { table: 'organizations', name: 'workflow_runs', column: 'org_id', refTable: 'workflow_runs' },
    { table: 'workflows', name: 'workflow_steps', column: 'workflow_id', refTable: 'workflow_steps' },
    { table: 'workflows', name: 'workflow_triggers', column: 'workflow_id', refTable: 'workflow_triggers' },
    { table: 'workflows', name: 'workflow_runs', column: 'workflow_id', refTable: 'workflow_runs' },
    { table: 'workflow_runs', name: 'step_runs', column: 'workflow_run_id', refTable: 'step_runs' },
  ];

  for (const rel of arrRels) {
    console.log(`  ${rel.table}.${rel.name}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: rel.table },
        name: rel.name,
        using: {
          foreign_key_constraint_on: {
            column: rel.column,
            table: { schema: 'public', name: rel.refTable }
          }
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  // 3. Permissions
  console.log('\n--- Creating Select Permissions ---');

  const selectPerms = [
    {
      table: 'organizations',
      filter: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } },
      columns: ['id', 'name', 'slug', 'quota_limit', 'quota_used', 'quota_reset_at', 'created_at', 'updated_at'],
      allow_aggregations: true
    },
    {
      table: 'org_members',
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ['id', 'org_id', 'user_id', 'role', 'created_at'],
      allow_aggregations: false
    },
    {
      table: 'workflows',
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ['id', 'org_id', 'name', 'description', 'is_active', 'created_by', 'created_at', 'updated_at'],
      allow_aggregations: true
    },
    {
      table: 'workflow_steps',
      filter: { workflow: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } } },
      columns: ['id', 'workflow_id', 'step_order', 'name', 'type', 'config', 'created_at'],
      allow_aggregations: false
    },
    {
      table: 'workflow_triggers',
      filter: { workflow: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } } },
      columns: ['id', 'workflow_id', 'type', 'config', 'is_active', 'created_at'],
      allow_aggregations: false
    },
    {
      table: 'workflow_runs',
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ['id', 'workflow_id', 'org_id', 'status', 'triggered_by', 'trigger_type', 'started_at', 'completed_at', 'created_at'],
      allow_aggregations: true
    },
    {
      table: 'step_runs',
      filter: { workflow_run: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } } },
      columns: ['id', 'workflow_run_id', 'workflow_step_id', 'status', 'input', 'output', 'error', 'attempt_count', 'approved_by', 'approved_at', 'started_at', 'completed_at', 'created_at'],
      allow_aggregations: false
    },
    {
      table: 'workflow_results',
      filter: { organization: { org_members: { user_id: { _eq: 'X-Hasura-User-Id' } } } },
      columns: ['id', 'workflow_run_id', 'org_id', 'result_type', 'data', 'created_at'],
      allow_aggregations: false
    },
    {
      table: 'org_monthly_usage',
      filter: { org_id: { _is_null: false } },
      columns: ['org_id', 'org_name', 'quota_limit', 'quota_used', 'quota_reset_at', 'runs_this_month', 'avg_run_duration_seconds'],
      allow_aggregations: false
    },
  ];

  for (const perm of selectPerms) {
    console.log(`  SELECT on ${perm.table}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_select_permission',
      args: {
        source: 'default',
        table: { schema: 'public', name: perm.table },
        role: 'user',
        permission: {
          filter: perm.filter,
          columns: perm.columns,
          allow_aggregations: perm.allow_aggregations || false
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  // Insert permissions
  console.log('\n--- Creating Insert Permissions ---');

  const insertPerms = [
    {
      table: 'workflows',
      check: {
        organization: {
          org_members: {
            _and: [
              { user_id: { _eq: 'X-Hasura-User-Id' } },
              { role: { _in: ['owner', 'editor'] } }
            ]
          }
        }
      },
      columns: ['org_id', 'name', 'description', 'is_active'],
      set: { created_by: 'x-hasura-User-Id' }
    },
    {
      table: 'workflow_steps',
      check: {
        workflow: {
          organization: {
            org_members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      },
      columns: ['workflow_id', 'step_order', 'name', 'type', 'config'],
      set: {}
    },
    {
      table: 'workflow_triggers',
      check: {
        workflow: {
          organization: {
            org_members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      },
      columns: ['workflow_id', 'type', 'config', 'is_active'],
      set: {}
    },
  ];

  for (const perm of insertPerms) {
    console.log(`  INSERT on ${perm.table}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_insert_permission',
      args: {
        source: 'default',
        table: { schema: 'public', name: perm.table },
        role: 'user',
        permission: {
          check: perm.check,
          columns: perm.columns,
          set: perm.set || {}
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  // Update permissions
  console.log('\n--- Creating Update Permissions ---');

  const updatePerms = [
    {
      table: 'workflows',
      filter: {
        organization: {
          org_members: {
            _and: [
              { user_id: { _eq: 'X-Hasura-User-Id' } },
              { role: { _in: ['owner', 'editor'] } }
            ]
          }
        }
      },
      columns: ['name', 'description', 'is_active', 'updated_at']
    },
    {
      table: 'workflow_steps',
      filter: {
        workflow: {
          organization: {
            org_members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      },
      columns: ['step_order', 'name', 'type', 'config']
    },
  ];

  for (const perm of updatePerms) {
    console.log(`  UPDATE on ${perm.table}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_update_permission',
      args: {
        source: 'default',
        table: { schema: 'public', name: perm.table },
        role: 'user',
        permission: {
          filter: perm.filter,
          columns: perm.columns
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  // Delete permissions
  console.log('\n--- Creating Delete Permissions ---');

  const deletePerms = [
    {
      table: 'workflows',
      filter: {
        organization: {
          org_members: {
            _and: [
              { user_id: { _eq: 'X-Hasura-User-Id' } },
              { role: { _eq: 'owner' } }
            ]
          }
        }
      }
    },
    {
      table: 'workflow_steps',
      filter: {
        workflow: {
          organization: {
            org_members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      }
    },
    {
      table: 'workflow_triggers',
      filter: {
        workflow: {
          organization: {
            org_members: {
              _and: [
                { user_id: { _eq: 'X-Hasura-User-Id' } },
                { role: { _in: ['owner', 'editor'] } }
              ]
            }
          }
        }
      }
    },
  ];

  for (const perm of deletePerms) {
    console.log(`  DELETE on ${perm.table}...`);
    const res = hasuraMetadataAPI({
      type: 'pg_create_delete_permission',
      args: {
        source: 'default',
        table: { schema: 'public', name: perm.table },
        role: 'user',
        permission: {
          filter: perm.filter
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }
  }

  // 4. Actions & Custom Types
  console.log('\n--- Creating Actions & Types ---');

  const typesRes = hasuraMetadataAPI({
    type: 'set_custom_types',
    args: {
      objects: [
        {
          name: 'TriggerWorkflowRunOutput',
          fields: [
            { name: 'workflow_run_id', type: 'uuid!' },
            { name: 'message', type: 'String!' }
          ]
        },
        {
          name: 'ApproveStepOutput',
          fields: [
            { name: 'success', type: 'Boolean!' },
            { name: 'message', type: 'String!' }
          ]
        },
        {
          name: 'WebhookTriggerOutput',
          fields: [
            { name: 'workflow_run_id', type: 'uuid!' },
            { name: 'message', type: 'String!' }
          ]
        }
      ],
      input_objects: [],
      scalars: [],
      enums: []
    }
  });
  console.log(`  Custom types: ${typesRes.message || JSON.stringify(typesRes)}`);

  const actions = [
    {
      name: 'triggerWorkflowRun',
      definition: {
        kind: 'synchronous',
        handler: '{{NHOST_FUNCTIONS_URL}}/trigger-workflow-run',
        forward_client_headers: true,
        arguments: [{ name: 'workflow_id', type: 'uuid!' }],
        output_type: 'TriggerWorkflowRunOutput'
      }
    },
    {
      name: 'approveStep',
      definition: {
        kind: 'synchronous',
        handler: '{{NHOST_FUNCTIONS_URL}}/approve-step',
        forward_client_headers: true,
        arguments: [{ name: 'step_run_id', type: 'uuid!' }],
        output_type: 'ApproveStepOutput'
      }
    },
    {
      name: 'webhookTrigger',
      definition: {
        kind: 'synchronous',
        handler: '{{NHOST_FUNCTIONS_URL}}/webhook-trigger',
        arguments: [
          { name: 'workflow_id', type: 'uuid!' },
          { name: 'webhook_secret', type: 'String' },
          { name: 'payload', type: 'jsonb' },
        ],
        output_type: 'WebhookTriggerOutput'
      }
    },
  ];

  for (const action of actions) {
    console.log(`  Action: ${action.name}...`);
    const res = hasuraMetadataAPI({
      type: 'create_action',
      args: {
        name: action.name,
        definition: {
          kind: action.definition.kind,
          handler: action.definition.handler,
          forward_client_headers: action.definition.forward_client_headers || false,
          type: 'mutation',
          arguments: action.definition.arguments.map(a => ({
            name: a.name,
            type: a.type
          })),
          output_type: action.definition.output_type
        }
      }
    });
    if (res.error && !res.error.includes('already exists')) {
      console.log(`    Warning: ${JSON.stringify(res)}`);
    } else {
      console.log(`    ✅`);
    }

    const permRes = hasuraMetadataAPI({
      type: 'create_action_permission',
      args: {
        action: action.name,
        role: 'user'
      }
    });
    if (permRes.error && !permRes.error.includes('already exists')) {
      console.log(`    Permission warning: ${JSON.stringify(permRes)}`);
    }
  }

  console.log('\n=== Metadata application finished! ===');
}

main().catch(console.error);
