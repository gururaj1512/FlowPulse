/**
 * lib/apollo.js — Apollo Client with WebSocket Subscriptions
 * 
 * Sets up Apollo Client with:
 * - HTTP link for queries and mutations
 * - WebSocket link for subscriptions (real-time step status updates)
 * - Dynamic Auth token injection via setContext for both transports
 */

import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

export function createApolloClient(nhostClient) {
  const getAuthHeaders = () => {
    const token = nhostClient.auth.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const authLink = setContext((_, { headers }) => {
    const token = nhostClient.auth.getAccessToken();
    return {
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
  });

  const httpLink = new HttpLink({
    uri: nhostClient.graphql.httpUrl,
  });

  const authenticatedHttpLink = authLink.concat(httpLink);

  const wsLink = typeof window !== 'undefined'
    ? new GraphQLWsLink(
        createClient({
          url: nhostClient.graphql.wsUrl,
          connectionParams: () => ({
            headers: getAuthHeaders(),
          }),
        })
      )
    : null;

  const link = wsLink
    ? split(
        ({ query }) => {
          const definition = getMainDefinition(query);
          return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
          );
        },
        wsLink,
        authenticatedHttpLink
      )
    : authenticatedHttpLink;

  return new ApolloClient({
    link,
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            org_members: {
              merge(existing, incoming) {
                return incoming;
              },
            },
            workflows: {
              merge(existing, incoming) {
                return incoming;
              },
            },
          },
        },
      },
    }),
    defaultOptions: {
      watchQuery: { fetchPolicy: 'network-only' },
      query: { fetchPolicy: 'network-only' },
    },
  });
}
