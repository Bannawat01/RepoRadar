import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PushEventSchema,
  PullRequestEventSchema,
  IssuesEventSchema,
} from '../schemas/github.js';
import {
  normalizePush,
  normalizePullRequest,
  normalizeIssues,
} from './toNormalized.js';

const repo = {
  full_name: 'bannawat/reporadar',
  html_url: 'https://github.com/bannawat/reporadar',
};
const sender = {
  login: 'bannawat',
  html_url: 'https://github.com/bannawat',
  avatar_url: 'https://avatars.githubusercontent.com/u/1',
};

function push(overrides: Record<string, unknown>) {
  return PushEventSchema.parse({
    ref: 'refs/heads/main',
    compare: 'https://github.com/bannawat/reporadar/compare/aaa...bbb',
    repository: repo,
    sender,
    commits: [],
    ...overrides,
  });
}

test('push: normal commits', () => {
  const n = normalizePush(
    push({
      commits: [
        { id: 'abcdef1234567', message: 'feat: add x\n\nbody', url: 'https://x/1' },
        { id: '1234567abcdef', message: 'fix: y', url: 'https://x/2' },
      ],
    }),
  );
  assert.equal(n.event, 'push');
  assert.equal(n.action, 'push');
  assert.equal(n.title, '2 commits pushed to main');
  assert.equal(n.meta.commitCount, 2);
  assert.ok(n.body?.includes('feat: add x (abcdef1)'));
  // only the subject line, not the body
  assert.ok(!n.body?.includes('body'));
});

test('push: singular commit wording', () => {
  const n = normalizePush(
    push({ commits: [{ id: 'aaaaaaa', message: 'one', url: 'https://x/1' }] }),
  );
  assert.equal(n.title, '1 commit pushed to main');
});

test('push: force-push', () => {
  const n = normalizePush(push({ forced: true, commits: [] }));
  assert.equal(n.action, 'force-push');
  assert.equal(n.meta.forced, true);
  assert.ok(n.title.includes('force-pushed to main'));
});

test('push: branch created', () => {
  const n = normalizePush(push({ created: true }));
  assert.equal(n.action, 'created');
  assert.equal(n.title, 'Created branch main');
});

test('push: branch deleted', () => {
  const n = normalizePush(push({ deleted: true }));
  assert.equal(n.action, 'deleted');
  assert.equal(n.title, 'Deleted branch main');
});

test('push: tag ref', () => {
  const n = normalizePush(push({ ref: 'refs/tags/v1.0.0', created: true }));
  assert.equal(n.meta.refKind, 'tag');
  assert.equal(n.title, 'Created tag v1.0.0');
});

function pr(action: string, prOverrides: Record<string, unknown> = {}) {
  return PullRequestEventSchema.parse({
    action,
    number: 42,
    repository: repo,
    sender,
    pull_request: {
      title: 'Add rate limiting',
      html_url: 'https://github.com/bannawat/reporadar/pull/42',
      head: { ref: 'feature/rl' },
      base: { ref: 'main' },
      ...prOverrides,
    },
  });
}

test('pr: opened', () => {
  const n = normalizePullRequest(pr('opened'));
  assert.equal(n.action, 'opened');
  assert.equal(n.title, 'PR #42 opened: Add rate limiting');
  assert.equal(n.meta.merged, false);
});

test('pr: closed without merge stays "closed"', () => {
  const n = normalizePullRequest(pr('closed', { merged: false }));
  assert.equal(n.action, 'closed');
  assert.equal(n.meta.merged, false);
});

test('pr: closed + merged becomes "merged"', () => {
  const n = normalizePullRequest(pr('closed', { merged: true }));
  assert.equal(n.action, 'merged');
  assert.equal(n.meta.merged, true);
  assert.equal(n.title, 'PR #42 merged: Add rate limiting');
});

test('pr: reopened', () => {
  const n = normalizePullRequest(pr('reopened'));
  assert.equal(n.action, 'reopened');
});

function issue(action: string, extra: Record<string, unknown> = {}) {
  return IssuesEventSchema.parse({
    action,
    repository: repo,
    sender,
    issue: {
      number: 7,
      title: 'Bug: crash on start',
      html_url: 'https://github.com/bannawat/reporadar/issues/7',
      labels: [{ name: 'bug' }],
      state: 'open',
    },
    ...extra,
  });
}

test('issues: opened with labels', () => {
  const n = normalizeIssues(issue('opened'));
  assert.equal(n.action, 'opened');
  assert.deepEqual(n.meta.labels, ['bug']);
  assert.equal(n.title, 'Issue #7 opened: Bug: crash on start');
});

test('issues: reopened', () => {
  const n = normalizeIssues(issue('reopened'));
  assert.equal(n.action, 'reopened');
});

test('issues: labeled carries changedLabel', () => {
  const n = normalizeIssues(issue('labeled', { label: { name: 'priority:high' } }));
  assert.equal(n.action, 'labeled');
  assert.equal(n.meta.changedLabel, 'priority:high');
});
