'use client';

/**
 * Navbar — Top navigation bar with org selector, role badge, and user details
 */

import { useSignOut, useUserData } from '@nhost/react';
import { useQuery, useApolloClient } from '@apollo/client/react';
import { useOrg } from '@/app/Providers';
import { GET_MY_ORGS } from '@/lib/graphql';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const user = useUserData();
  const { signOut } = useSignOut();
  const router = useRouter();
  const apolloClient = useApolloClient();
  const { currentOrg, currentRole, setCurrentOrg, clearOrg } = useOrg();
  
  const { data } = useQuery(GET_MY_ORGS, {
    fetchPolicy: 'network-only',
  });
  const memberships = data?.org_members || [];

  // Auto-select or validate org and role
  useEffect(() => {
    if (memberships.length > 0) {
      const matchingMembership = currentOrg 
        ? memberships.find(m => m.organization.id === currentOrg.id) 
        : null;
      
      if (matchingMembership) {
        if (currentRole !== matchingMembership.role) {
          setCurrentOrg(matchingMembership.organization, matchingMembership.role);
        }
      } else {
        const savedOrgId = typeof window !== 'undefined' ? localStorage.getItem('flowpulse_org_id') : null;
        const savedMembership = memberships.find(m => m.organization.id === savedOrgId);
        
        if (savedMembership) {
          setCurrentOrg(savedMembership.organization, savedMembership.role);
        } else {
          setCurrentOrg(memberships[0].organization, memberships[0].role);
        }
      }
    }
  }, [memberships, currentOrg, currentRole, setCurrentOrg]);

  const handleOrgChange = (e) => {
    const membership = memberships.find(m => m.organization.id === e.target.value);
    if (membership) {
      setCurrentOrg(membership.organization, membership.role);
    }
  };

  const handleSignOut = async () => {
    if (clearOrg) clearOrg();
    if (apolloClient) {
      try {
        await apolloClient.clearStore();
      } catch (e) {
        console.error('Error clearing apollo store:', e);
      }
    }
    await signOut();
    router.push('/');
  };

  const quotaPercent = currentOrg 
    ? Math.round((currentOrg.quota_used / currentOrg.quota_limit) * 100) 
    : 0;

  return (
    <nav className="navbar">
      <div className="flex items-center gap-lg">
        <a href="/dashboard" className="navbar-brand">
          <div className="navbar-brand-icon">⚡</div>
          <span>FlowPulse</span>
        </a>
      </div>

      <div className="navbar-right">
        {/* Quota Indicator Pill */}
        {currentOrg && (
          <div className="quota-badge-container">
            <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              QUOTA: <strong style={{ color: 'var(--text-primary)' }}>{currentOrg.quota_used}/{currentOrg.quota_limit}</strong>
            </div>
            <div className="quota-bar">
              <div 
                className={`quota-bar-fill ${quotaPercent > 80 ? 'warning' : ''}`}
                style={{ width: `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Org Selector */}
        {memberships.length > 0 && (
          <select 
            className="org-selector"
            value={currentOrg?.id || ''}
            onChange={handleOrgChange}
          >
            {memberships.map(m => (
              <option key={m.id} value={m.organization.id}>
                🏢 {m.organization.name} ({m.role.toUpperCase()})
              </option>
            ))}
          </select>
        )}

        {/* Role Badge */}
        {currentRole && (
          <span className={`role-badge role-${currentRole}`}>
            {currentRole}
          </span>
        )}

        {/* User Info & Logout */}
        <div className="user-info">
          <span className="truncate font-mono text-xs" style={{ maxWidth: '140px', color: 'var(--text-secondary)' }}>
            👤 {user?.displayName || user?.email}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}
