import { graphql } from "@octokit/graphql";
import type { GitHubResponse, GitHubQueryOptions } from "./types.js";

/**
 * Get GitHub API token from environment or throw error
 */
export function getGitHubToken(): string {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    throw new Error("GITHUB_PAT environment variable is required for GitHub API access");
  }
  return token;
}

/**
 * Initialize GraphQL client
 */
export function createGitHubClient() {
  const token = getGitHubToken();
  
  return graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });
}

/**
 * Fetch all repositories for the authenticated user
 * Handles pagination automatically
 */
export async function fetchAllRepositories(options: GitHubQueryOptions = {}): Promise<any[]> {
  const graphql = createGitHubClient();
  const limit = options.limit ?? 100;
  
  const query = `
    query($cursor: String, $first: Int!) {
      viewer {
        repositories(first: $first, after: $cursor, orderBy: {field: PUSHED_AT, direction: DESC}) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              nameWithOwner
              url
              description
              primaryLanguage {
                name
                color
              }
              languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                edges {
                  node {
                    name
                    color
                  }
                  size
                }
                totalCount
              }
              stargazerCount
              forkCount
              isFork
              isArchived
              isEmpty
              openIssues {
                totalCount
              }
              licenseInfo {
                key
                name
                spdxId
              }
              topicNodes(first: 20) {
                topic {
                  name
                }
              }
              createdAt
              pushedAt
              updatedAt
              homepageUrl
              descriptionHtml
            }
          }
        }
      }
    }
  `;

  const repositories: any[] = [];
  let cursor: string | undefined = undefined;
  let pagesFetched = 0;

  while (pagesFetched < Math.ceil(limit / 100) + 1) {
    try {
      const result: GitHubResponse = await graphql(query, {
        first: Math.min(100, limit - repositories.length),
        cursor,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (result.errors) {
        console.error("GitHub API errors:", result.errors);
        break;
      }

      const repoEdges = result.data.viewer.repositories.edges;
      repositories.push(...repoEdges.map((edge) => edge.node));

      const { hasNextPage, endCursor } = result.data.viewer.repositories.pageInfo;
      if (!hasNextPage || repositories.length >= limit) {
        break;
      }

      cursor = endCursor;
      pagesFetched++;
    } catch (error) {
      console.error("Error fetching repositories:", error);
      break;
    }
  }

  return repositories.slice(0, limit);
}

/**
 * Fetch repositories for a specific user/org
 */
export async function fetchUserRepositories(
  username: string,
  options: GitHubQueryOptions = {}
): Promise<any[]> {
  const graphql = createGitHubClient();
  const limit = options.limit ?? 100;

  const query = `
    query($username: String!, $cursor: String, $first: Int!) {
      user(login: $username) {
        repositories(first: $first, after: $cursor, orderBy: {field: PUSHED_AT, direction: DESC}, types: [SOURCE]) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              nameWithOwner
              url
              description
              primaryLanguage {
                name
                color
              }
              languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                edges {
                  node {
                    name
                    color
                  }
                  size
                }
                totalCount
              }
              stargazerCount
              forkCount
              isFork
              isArchived
              isEmpty
              openIssues {
                totalCount
              }
              licenseInfo {
                key
                name
                spdxId
              }
              topicNodes(first: 20) {
                topic {
                  name
                }
              }
              createdAt
              pushedAt
              updatedAt
              homepageUrl
              descriptionHtml
            }
          }
        }
      }
    }
  `;

  const repositories: any[] = [];
  let cursor: string | undefined = undefined;

  while (repositories.length < limit) {
    try {
      const result: any = await graphql(query, {
        username,
        first: Math.min(100, limit - repositories.length),
        cursor,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (result.errors) {
        console.error("GitHub API errors:", result.errors);
        break;
      }

      const repoEdges = result.data.user.repositories.edges;
      repositories.push(...repoEdges.map((edge) => edge.node));

      const { hasNextPage, endCursor } = result.data.user.repositories.pageInfo;
      if (!hasNextPage || repositories.length >= limit) {
        break;
      }

      cursor = endCursor;
    } catch (error) {
      console.error("Error fetching user repositories:", error);
      break;
    }
  }

  return repositories;
}
