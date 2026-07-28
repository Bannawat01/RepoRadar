import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscordPayload } from './embeds.js';
import type { NormalizedEvent } from '../types/index.js';

function base(over: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    event: 'push',
    action: null,
    repo: { name: 'bannawat/reporadar', url: 'https://github.com/x' },
    actor: { login: 'bannawat', url: 'https://github.com/bannawat', avatar: null },
    title: 'title',
    body: null,
    url: 'https://github.com/x/compare/a...b',
    meta: {},
    ...over,
  };
}

test('push embed: branch + commit count fields', () => {
  const { username, embeds } = buildDiscordPayload(
    base({ meta: { ref: 'main', refKind: 'branch', commitCount: 3 } }),
  );
  assert.equal(username, 'RepoRadar');
  const e = embeds[0]!;
  assert.equal(e.footer.text, 'RepoRadar • push');
  assert.deepEqual(
    e.fields.map((f) => [f.name, f.value]),
    [
      ['Repository', 'bannawat/reporadar'],
      ['Branch', 'main'],
      ['Commits', '3'],
    ],
  );
});

test('push embed: deleted ref uses the red color', () => {
  const { embeds } = buildDiscordPayload(
    base({ meta: { ref: 'old', deleted: true, commitCount: 0 } }),
  );
  assert.equal(embeds[0]!.color, 15158332);
  assert.match(embeds[0]!.title, /^🗑️/);
});

test('pull_request embed: flow + changes fields', () => {
  const { embeds } = buildDiscordPayload(
    base({
      event: 'pull_request',
      action: 'opened',
      meta: { head: 'feat/x', base: 'main', additions: 10, deletions: 2, changedFiles: 3 },
    }),
  );
  const e = embeds[0]!;
  assert.equal(e.footer.text, 'RepoRadar • pull request • opened');
  assert.equal(e.fields[1]!.value, '`feat/x` → `main`');
  assert.equal(e.fields[2]!.value, '+10 / -2 (3 files)');
});

test('issues embed: labels joined, em dash when empty', () => {
  const withLabels = buildDiscordPayload(
    base({ event: 'issues', action: 'opened', meta: { state: 'open', labels: ['bug', 'p1'] } }),
  ).embeds[0]!;
  assert.equal(withLabels.fields[2]!.value, 'bug, p1');

  const none = buildDiscordPayload(
    base({ event: 'issues', action: 'closed', meta: { state: 'closed', labels: [] } }),
  ).embeds[0]!;
  assert.equal(none.fields[2]!.value, '—');
  assert.equal(none.color, 3066993);
});

test('title is clipped to 256 chars', () => {
  const { embeds } = buildDiscordPayload(base({ title: 'a'.repeat(400) }));
  assert.equal(embeds[0]!.title.length, 256);
  assert.ok(embeds[0]!.title.endsWith('…'));
});
