# DEPLOYMENT — How to Deploy FlowPulse

## Overview

**FlowPulse** is an enterprise multi-tenant workflow automation platform designed as a unified monorepo containing:
1. **Nhost Backend** (Postgres 14 + Hasura GraphQL Engine + Auth + Node Serverless Functions) → Deployed to Nhost Cloud.
2. **Next.js Frontend** (React + Apollo Client + GraphQL Subscriptions) → Deployed to Vercel.

---

## Part 1: Deploying the Nhost Backend to Nhost Cloud

### 1. Create a Project on Nhost Cloud

1. Sign up at [nhost.io](https://nhost.io) (Free Starter tier: 1 GB DB, 1 GB storage, 5 GB bandwidth).
2. Create a new project — choose a region close to your primary users.
3. Note your project's **Subdomain** (e.g., `abcdef123`) and **Region** (e.g., `us-east-1`) from the Nhost Dashboard.

### 2. Link Local Monorepo to Nhost Cloud

```bash
# Log in to Nhost CLI
nhost login

# Link your local monorepo directory to your Nhost cloud project
nhost link

# Follow the interactive prompt to select your project
```

### 3. Deploy Database Migrations, Hasura Metadata & Functions

When connected to GitHub, Nhost Cloud automatically deploys on `git push`. Alternatively, deploy manually via Nhost CLI:

```bash
# Apply Postgres database schema migrations
nhost dev hasura migrate apply

# Apply Hasura permissions, relationships, and Actions metadata
nhost dev hasura metadata apply

# Apply demo organization seed data
nhost dev hasura seed apply
```

### 4. Configure Environment Variables in Nhost Dashboard

In the Nhost Dashboard, navigate to **Settings → Environment Variables** and configure:

| Secret / Variable | Purpose | Example / Source |
|---|---|---|
| `GROQ_API_KEY` | Real LLM execution steps via Groq API (`llama-3.3-70b-versatile`) | `gsk_...` from [console.groq.com](https://console.groq.com) |
| `NTFY_TOPIC` | Push notification topic for alert steps | `flowpulse-demo` |

### 5. Seed Initial Demo Users

After deploying the database schema to cloud, populate demo workspace users:

```bash
NHOST_AUTH_URL=https://xiruuojpscirkcviwgcy.auth.ap-south-1.nhost.run/v1 \
NHOST_GRAPHQL_URL=https://xiruuojpscirkcviwgcy.graphql.ap-south-1.nhost.run/v1 \
HASURA_GRAPHQL_ADMIN_SECRET=<your-hasura-admin-secret> \
node functions/seed-users.js
```

---

## Part 2: Deploying the Frontend to Vercel

### 1. Import Repository in Vercel

1. Log in to [vercel.com](https://vercel.com).
2. Click **New Project** and import your FlowPulse repository.
3. Set the **Root Directory** to `frontend`.
4. Framework Preset: **Next.js** (auto-detected).

### 2. Set Environment Variables in Vercel

In Vercel **Project Settings → Environment Variables**, add:

| Environment Variable | Description | Value Example |
|---|---|---|
| `NEXT_PUBLIC_NHOST_SUBDOMAIN` | Nhost Cloud Project Subdomain | `abcdef123` |
| `NEXT_PUBLIC_NHOST_REGION` | Nhost Cloud Project Region | `us-east-1` |

### 3. Configure CORS in Nhost

To allow cross-origin GraphQL queries and subscriptions from your Vercel deployment:
1. Go to **Nhost Dashboard → Settings → Hasura → CORS Domains**.
2. Add your Vercel deployment URL: `https://your-flowpulse.vercel.app`.

---

## Part 3: Architecture & Connection Verification

The FlowPulse frontend automatically constructs connection endpoints using the Nhost React SDK:

```javascript
// In frontend/src/lib/nhost.js
const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN, // 'local' for local dev
  region: process.env.NEXT_PUBLIC_NHOST_REGION,       // '' for local dev
});
```

### Automatic Nhost SDK Endpoint Mapping:
- **GraphQL API:** `https://<subdomain>.graphql.<region>.nhost.run/v1`
- **Auth API:** `https://<subdomain>.auth.<region>.nhost.run/v1`
- **Serverless Functions:** `https://<subdomain>.functions.<region>.nhost.run/v1`

---

## Part 4: Deployment Verification Checklist

- [x] **Authentication:** Log in as `owner_a@demo.com` (`password123`) on Vercel deployment.
- [x] **Workspace Isolation:** Verify Org A (`Acme Corp`) workflows load, and switching to Org B (`Beta Inc`) dynamically switches user context.
- [x] **Real-time Execution:** Trigger a workflow run and observe WebSocket status streaming in the Live Run Viewer without page refreshes.
- [x] **Approval Gate:** Verify `approval_gate` step pauses execution, and clicking **"✓ APPROVE & CONTINUE WORKFLOW"** resumes the execution flow.
- [x] **Cross-Org Authorization Security:** Log in as `viewer_b@demo.com` and verify that manual execution mutation triggers are rejected with `403 Forbidden`.
