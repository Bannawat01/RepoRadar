import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from './eventLog.js';
import type { NormalizedEvent } from '../types/index.js';

function ev(title: string): NormalizedEvent {
  return {
    event: 'push',
    action: 'push',
    repo: { name: 'a/b', url: 'https://github.com/a/b' },
    actor: { login: 'a', url: 'https://github.com/a', avatar: null },
    title,
    body: null,
    url: 'https://x',
    meta: {},
  };
}

test('recent(): newest first, capped', () => {
  const log = new EventLog(50);
  log.add(ev('1'), 'd1');
  log.add(ev('2'), 'd2');
  log.add(ev('3'), 'd3');
  const r = log.recent(2);
  assert.equal(r.length, 2);
  assert.equal(r[0]?.title, '3');
  assert.equal(r[1]?.title, '2');
});

test('ring buffer evicts oldest beyond capacity', () => {
  const log = new EventLog(3);
  for (let i = 1; i <= 5; i++) log.add(ev(String(i)), `d${i}`);
  const r = log.recent(10);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((e) => e.title), ['5', '4', '3']);
});

test('dedup: hasSeen / markSeen', () => {
  const log = new EventLog();
  assert.equal(log.hasSeen('abc'), false);
  log.markSeen('abc');
  assert.equal(log.hasSeen('abc'), true);
  // undefined delivery id is never "seen"
  assert.equal(log.hasSeen(undefined), false);
  log.markSeen(undefined); // no-op, must not throw
});

test('dedup: seen set evicts oldest beyond capacity', () => {
  const log = new EventLog(50, 2);
  log.markSeen('a');
  log.markSeen('b');
  log.markSeen('c'); // evicts 'a'
  assert.equal(log.hasSeen('a'), false);
  assert.equal(log.hasSeen('b'), true);
  assert.equal(log.hasSeen('c'), true);
});

test('stored event carries id + receivedAt', () => {
  const log = new EventLog();
  const s = log.add(ev('x'), 'delivery-1', '2026-07-12T00:00:00.000Z');
  assert.equal(s.id, 'delivery-1');
  assert.equal(s.receivedAt, '2026-07-12T00:00:00.000Z');
  assert.equal(s.title, 'x');
});
