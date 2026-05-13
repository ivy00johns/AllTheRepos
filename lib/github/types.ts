// GitHub API types for GraphQL responses

export interface GitHubRepository {
  id: string;
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  primaryLanguage: {
    name: string;
    color: string;
  } | null;
  languages: {
    totalCount: number;
    edges: { node: { name: string; color: string }; size: number }[];
  };
  stargazerCount: number;
  forkCount: number;
  isFork: boolean;
  isArchived: boolean;
  isEmpty: boolean;
  openIssues: { totalCount: number };
  licenseInfo: {
    key: string;
    name: string;
    spdxId: string | null;
  } | null;
  topicNodes: { topic: { name: string } }[];
  createdAt: string;
  pushedAt: string;
  updatedAt: string;
  homepageUrl: string | null;
  descriptionHtml: string | null;
}

export interface GitHubViewer {
  login: string;
  id: string;
  repositories: {
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
    edges: { node: GitHubRepository }[];
  };
}

export interface GitHubResponse {
  data: {
    viewer: GitHubViewer;
  };
  errors?: any[];
}

export interface GitHubQueryOptions {
  limit?: number;
  after?: string;
  includeReadme?: boolean;
}

// Local correlation between Git remote URL and GitHub repo
export interface GitHubRepoRef {
  owner: string;
  name: string;
  url: string;
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  // Handle SSH format: git@github.com:user/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2], url: `https://github.com/${sshMatch[1]}/${sshMatch[2]}` };
  }

  // Handle HTTPS format: https://github.com/user/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2], url: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}` };
  }

  // Handle HTTPS with www
  const wwwMatch = remoteUrl.match(/^https?:\/\/www\.github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (wwwMatch) {
    return { owner: wwwMatch[1], name: wwwMatch[2], url: `https://github.com/${wwwMatch[1]}/${wwwMatch[2]}` };
  }

  return null;
}
