/** GitHub event names RepoRadar handles. */
export type GitHubEventName = 'push' | 'pull_request' | 'issues' | 'ping';

/**
 * The stable, minimal shape RepoRadar forwards to n8n. Downstream logic
 * (n8n branching, Discord embeds) depends on THIS, never on GitHub's raw payload.
 */
export interface NormalizedEvent {
  event: 'push' | 'pull_request' | 'issues';
  action: string | null;
  repo: {
    name: string; // "owner/repo"
    url: string;
  };
  actor: {
    login: string;
    url: string;
    avatar: string | null;
  };
  title: string;
  body: string | null;
  url: string;
  meta: Record<string, unknown>;
}
