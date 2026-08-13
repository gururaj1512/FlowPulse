/**
 * lib/nhost.js — nhost Client Configuration
 * 
 * Creates and exports the nhost client instance used throughout the app.
 * 
 * WHAT nhost IS: nhost is an open-source backend platform that bundles
 * PostgreSQL, Hasura GraphQL Engine, Authentication, Storage, and 
 * Serverless Functions into one managed service. Think of it as an 
 * open-source Firebase alternative built on Postgres + GraphQL.
 * 
 * For local development: nhost runs via Docker (started with `nhost up`).
 * The local GraphQL endpoint is at http://localhost:1337/v1/graphql.
 */

import { NhostClient } from '@nhost/nhost-js';

const nhost = new NhostClient({
  // For local development, subdomain is 'local' and region is empty.
  // For production, these come from your nhost cloud project settings.
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local',
  region: process.env.NEXT_PUBLIC_NHOST_REGION || '',
});

export default nhost;
