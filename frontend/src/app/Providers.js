'use client';

/**
 * Providers.js — App-wide Context Providers
 * 
 * Wraps the app with nhost auth provider and Apollo Client.
 * Must be a client component because nhost/Apollo use browser APIs.
 * 
 * WHAT THIS DOES:
 * - NhostProvider: Makes auth state (login, signup, user info) available
 *   to all components via React context
 * - ApolloProvider: Makes the GraphQL client (with WebSocket subscriptions)
 *   available to all components via useQuery/useMutation/useSubscription hooks
 */

import { NhostProvider, useUserData } from '@nhost/react';
import { ApolloProvider } from '@apollo/client/react';
import { useState, useEffect, createContext, useContext } from 'react';
import nhost from '@/lib/nhost';
import { createApolloClient } from '@/lib/apollo';

// Org context — stores the currently selected organization
export const OrgContext = createContext({
  currentOrg: null,
  currentRole: null,
  setCurrentOrg: () => {},
  clearOrg: () => {},
});

export function useOrg() {
  return useContext(OrgContext);
}

export default function Providers({ children }) {
  const [apolloClient, setApolloClient] = useState(null);

  useEffect(() => {
    const client = createApolloClient(nhost);
    setApolloClient(client);
  }, []);

  if (!apolloClient) {
    return (
      <div className="loading-center" style={{ minHeight: '100vh' }}>
        <div className="spinner spinner-lg" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={apolloClient}>
        <OrgProvider apolloClient={apolloClient}>
          {children}
        </OrgProvider>
      </ApolloProvider>
    </NhostProvider>
  );
}

function OrgProvider({ children, apolloClient }) {
  const user = useUserData();
  const [currentOrg, setCurrentOrgState] = useState(null);
  const [currentRole, setCurrentRole] = useState(null);
  const [lastUserId, setLastUserId] = useState(null);

  // Watch for user changes (login/logout/user switch)
  useEffect(() => {
    const currentUserId = user?.id || null;
    if (lastUserId !== null && lastUserId !== currentUserId) {
      // User changed or logged out — wipe org state & clear Apollo store
      setCurrentOrgState(null);
      setCurrentRole(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('flowpulse_org_id');
        localStorage.removeItem('flowpulse_org_role');
      }
      if (apolloClient) {
        apolloClient.clearStore().catch(() => {});
      }
    }
    setLastUserId(currentUserId);
  }, [user, lastUserId, apolloClient]);

  const setCurrentOrg = (org, role) => {
    setCurrentOrgState(org);
    setCurrentRole(role);
    if (typeof window !== 'undefined') {
      if (org) {
        localStorage.setItem('flowpulse_org_id', org.id);
        localStorage.setItem('flowpulse_org_role', role);
      } else {
        localStorage.removeItem('flowpulse_org_id');
        localStorage.removeItem('flowpulse_org_role');
      }
    }
  };

  const clearOrg = () => {
    setCurrentOrgState(null);
    setCurrentRole(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('flowpulse_org_id');
      localStorage.removeItem('flowpulse_org_role');
    }
    if (apolloClient) {
      apolloClient.clearStore().catch(() => {});
    }
  };

  return (
    <OrgContext.Provider value={{ currentOrg, currentRole, setCurrentOrg, clearOrg }}>
      {children}
    </OrgContext.Provider>
  );
}
