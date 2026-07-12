import type { NormalizedEvent } from '../types/index.js';

/** A stored event = the normalized payload plus receive metadata. */
export interface StoredEvent extends NormalizedEvent {
  id: string; // X-GitHub-Delivery (or a generated fallback)
  receivedAt: string; // ISO timestamp
}

/**
 * Tiny in-memory store. Two jobs:
 *  1. Keep the last `capacity` events for the /logs activity feed (ring buffer).
 *  2. Remember recently-seen delivery IDs so GitHub retries are idempotent.
 *
 * This is process-local and resets on restart — fine until a DB is added.
 * Swap this module for a Redis/Postgres-backed one later without touching routes.
 */
class EventLog {
  private readonly events: StoredEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    private readonly capacity = 50,
    private readonly seenCapacity = 1000,
  ) {}

  /** Returns true if this delivery ID was already processed. */
  hasSeen(deliveryId: string | undefined): boolean {
    return deliveryId ? this.seen.has(deliveryId) : false;
  }

  /** Record a delivery ID as processed, evicting the oldest when full. */
  markSeen(deliveryId: string | undefined): void {
    if (!deliveryId || this.seen.has(deliveryId)) return;
    this.seen.add(deliveryId);
    this.seenOrder.push(deliveryId);
    if (this.seenOrder.length > this.seenCapacity) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seen.delete(evicted);
    }
  }

  /** Add a normalized event to the ring buffer. */
  add(event: NormalizedEvent, id: string, receivedAt = new Date().toISOString()): StoredEvent {
    const stored: StoredEvent = { ...event, id, receivedAt };
    this.events.push(stored);
    if (this.events.length > this.capacity) this.events.shift();
    return stored;
  }

  /** Most recent `limit` events, newest first. */
  recent(limit = 5): StoredEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /** Test/maintenance helper. */
  clear(): void {
    this.events.length = 0;
    this.seen.clear();
    this.seenOrder.length = 0;
  }
}

/** Shared singleton used across routes. */
export const eventLog = new EventLog();
export { EventLog };
