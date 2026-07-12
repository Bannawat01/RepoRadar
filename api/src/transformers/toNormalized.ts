import type {
  PushEvent,
  PullRequestEvent,
  IssuesEvent,
} from '../schemas/github.js';
import type { NormalizedEvent } from '../types/index.js';

const shortRef = (ref: string): string =>
  ref.replace(/^refs\/(heads|tags)\//, '');

const isTag = (ref: string): boolean => ref.startsWith('refs/tags/');

function actorOf(sender: {
  login: string;
  html_url: string;
  avatar_url?: string;
}) {
  return {
    login: sender.login,
    url: sender.html_url,
    avatar: sender.avatar_url ?? null,
  };
}

export function normalizePush(p: PushEvent): NormalizedEvent {
  const name = shortRef(p.ref);
  const refKind = isTag(p.ref) ? 'tag' : 'branch';
  const count = p.commits.length;

  // Edge cases: branch/tag created or deleted carry zero commits.
  let action: NormalizedEvent['action'] = null;
  let title: string;
  if (p.deleted) {
    action = 'deleted';
    title = `Deleted ${refKind} ${name}`;
  } else if (p.created) {
    action = 'created';
    title = `Created ${refKind} ${name}`;
  } else {
    action = p.forced ? 'force-push' : 'push';
    const verb = p.forced ? 'force-pushed' : 'pushed';
    title = `${count} commit${count === 1 ? '' : 's'} ${verb} to ${name}`;
  }

  const body =
    p.commits
      .slice(0, 5)
      .map((c) => `• ${c.message.split('\n')[0]} (${c.id.slice(0, 7)})`)
      .join('\n') || null;

  return {
    event: 'push',
    action,
    repo: { name: p.repository.full_name, url: p.repository.html_url },
    actor: actorOf(p.sender),
    title,
    body,
    url: p.compare,
    meta: {
      ref: name,
      refKind,
      commitCount: count,
      forced: p.forced ?? false,
      created: p.created ?? false,
      deleted: p.deleted ?? false,
    },
  };
}

export function normalizePullRequest(p: PullRequestEvent): NormalizedEvent {
  const pr = p.pull_request;
  // "closed" splits into merged vs closed-without-merge.
  const merged = p.action === 'closed' && pr.merged === true;
  const action = merged ? 'merged' : p.action;

  return {
    event: 'pull_request',
    action,
    repo: { name: p.repository.full_name, url: p.repository.html_url },
    actor: actorOf(p.sender),
    title: `PR #${p.number} ${action}: ${pr.title}`,
    body: pr.body ?? null,
    url: pr.html_url,
    meta: {
      number: p.number,
      head: pr.head.ref,
      base: pr.base.ref,
      merged,
      draft: pr.draft ?? false,
      additions: pr.additions ?? null,
      deletions: pr.deletions ?? null,
      changedFiles: pr.changed_files ?? null,
    },
  };
}

export function normalizeIssues(p: IssuesEvent): NormalizedEvent {
  const issue = p.issue;
  // "labeled"/"unlabeled" carry the specific label on the top-level payload.
  const changedLabel = p.label?.name ?? null;

  return {
    event: 'issues',
    action: p.action,
    repo: { name: p.repository.full_name, url: p.repository.html_url },
    actor: actorOf(p.sender),
    title: `Issue #${issue.number} ${p.action}: ${issue.title}`,
    body: issue.body ?? null,
    url: issue.html_url,
    meta: {
      number: issue.number,
      state: issue.state ?? null,
      labels: issue.labels.map((l) => l.name),
      changedLabel,
    },
  };
}
