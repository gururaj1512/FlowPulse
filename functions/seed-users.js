/**
 * seed-users.js — Create demo users via nhost Auth API
 * 
 * This script creates 6 demo users (3 per org) and assigns them
 * to organizations with appropriate roles. Run this AFTER nhost is up
 * and the SQL seed has created the organizations.
 * 
 * Usage: node functions/seed-users.js
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const AUTH_URL = process.env.NHOST_AUTH_URL || 'https://local.auth.nhost.run/v1';
const GRAPHQL_URL = process.env.NHOST_GRAPHQL_URL || 'https://local.graphql.nhost.run/v1';
const ADMIN_SECRET = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'nhost-admin-secret';

const DEMO_PASSWORD = 'password123';

const USERS = [
  { email: 'owner_a@demo.com', displayName: 'Alice Owner Org A', orgId: 'a0000000-0000-0000-0000-000000000001', role: 'owner' },
  { email: 'editor_a@demo.com', displayName: 'Bob Editor Org A', orgId: 'a0000000-0000-0000-0000-000000000001', role: 'editor' },
  { email: 'viewer_a@demo.com', displayName: 'Carol Viewer Org A', orgId: 'a0000000-0000-0000-0000-000000000001', role: 'viewer' },
  { email: 'owner_b@demo.com', displayName: 'Dave Owner Org B', orgId: 'b0000000-0000-0000-0000-000000000002', role: 'owner' },
  { email: 'editor_b@demo.com', displayName: 'Eve Editor Org B', orgId: 'b0000000-0000-0000-0000-000000000002', role: 'editor' },
  { email: 'viewer_b@demo.com', displayName: 'Frank Viewer Org B', orgId: 'b0000000-0000-0000-0000-000000000002', role: 'viewer' },
];

async function getUserIdByEmail(email) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      query: `
        query GetUser($email: citext!) {
          users(where: { email: { _eq: $email } }) {
            id
          }
        }
      `,
      variables: { email },
    }),
  });

  const data = await response.json();
  return data.data?.users?.[0]?.id;
}

async function signupUser(email, password, displayName) {
  const existingId = await getUserIdByEmail(email);
  if (existingId) {
    console.log(`  ⚠ User ${email} already exists.`);
    return existingId;
  }

  let response = await fetch(`${AUTH_URL}/signup/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      options: {
        displayName,
      },
    }),
  });

  if (response.status === 429) {
    console.log(`  ⏳ Rate limited, waiting 3s...`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return signupUser(email, password, displayName);
  }

  let data = {};
  try {
    data = await response.json();
  } catch (e) {}

  if (!response.ok) {
    const checkId = await getUserIdByEmail(email);
    if (checkId) return checkId;
    throw new Error(`Signup failed for ${email}: ${JSON.stringify(data)}`);
  }

  return data.session?.user?.id || await getUserIdByEmail(email);
}

async function addOrgMember(orgId, userId, role) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      query: `
        mutation AddOrgMember($orgId: uuid!, $userId: uuid!, $role: String!) {
          insert_org_members_one(
            object: { org_id: $orgId, user_id: $userId, role: $role },
            on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }
          ) {
            id
            role
          }
        }
      `,
      variables: { orgId, userId, role },
    }),
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Failed to add member: ${JSON.stringify(data.errors)}`);
  }
  return data.data?.insert_org_members_one;
}

async function updateWorkflowCreator(workflowId, userId) {
  await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      query: `
        mutation UpdateCreator($workflowId: uuid!, $userId: uuid!) {
          update_workflows_by_pk(
            pk_columns: { id: $workflowId },
            _set: { created_by: $userId }
          ) {
            id
          }
        }
      `,
      variables: { workflowId, userId },
    }),
  });
}

async function main() {
  console.log('🌱 Seeding demo users...\n');
  
  let ownerAId = null;
  let ownerBId = null;

  for (const user of USERS) {
    try {
      console.log(`Creating ${user.email}...`);
      const userId = await signupUser(user.email, DEMO_PASSWORD, user.displayName);
      
      if (!userId) {
        console.error(`  ✗ Could not get user ID for ${user.email}`);
        continue;
      }

      console.log(`  ✓ User ID: ${userId}`);

      if (user.email === 'owner_a@demo.com') ownerAId = userId;
      if (user.email === 'owner_b@demo.com') ownerBId = userId;

      const member = await addOrgMember(user.orgId, userId, user.role);
      console.log(`  ✓ Added as ${member.role} to org`);
      
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (ownerAId) {
    await updateWorkflowCreator('11111111-0000-0000-0000-000000000001', ownerAId);
    console.log('\n✓ Set Org A workflow creator to owner_a');
  }
  if (ownerBId) {
    await updateWorkflowCreator('11111111-0000-0000-0000-000000000002', ownerBId);
    console.log('✓ Set Org B workflow creator to owner_b');
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('Demo credentials (all passwords: "password123"):');
  console.log('  Org A (Acme Corp): owner_a@demo.com, editor_a@demo.com, viewer_a@demo.com');
  console.log('  Org B (Beta Inc):  owner_b@demo.com, editor_b@demo.com, viewer_b@demo.com');
}

main().catch(console.error);
