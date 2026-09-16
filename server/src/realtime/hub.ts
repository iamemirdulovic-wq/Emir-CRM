import type { Response } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Server-Sent Events hub for the inbox and the board.
 *
 * SSE rather than WebSockets because it survives Hostinger's proxy without
 * special configuration, and the client falls back to 4-second polling when
 * even SSE is blocked.
 */

export type RealtimeEvent = {
  type:
    | 'message.created'
    | 'message.status'
    | 'conversation.updated'
    | 'opportunity.moved'
    | 'typing'
    | 'lead.assigned';
  payload: Record<string, unknown>;
  /** Deliver only to these users. Empty means everyone. */
  audience?: string[];
};

type Client = { id: string; userId: string; res: Response };

const clients = new Map<string, Client>();

export function addClient(id: string, userId: string, res: Response): void {
  clients.set(id, { id, userId, res });
  logger.debug('realtime client connected', { userId, clients: clients.size });
}

export function removeClient(id: string): void {
  clients.delete(id);
}

export function clientCount(): number {
  return clients.size;
}

/** Broadcast an event. Dead sockets are dropped rather than retried. */
export function publish(event: RealtimeEvent): number {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  let delivered = 0;

  for (const client of clients.values()) {
    if (event.audience?.length && !event.audience.includes(client.userId)) continue;
    try {
      client.res.write(payload);
      delivered += 1;
    } catch {
      clients.delete(client.id);
    }
  }
  return delivered;
}

/** Keep proxies from closing an idle stream. */
export function startHeartbeat(intervalMs = 25_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const client of clients.values()) {
      try {
        client.res.write(': ping\n\n');
      } catch {
        clients.delete(client.id);
      }
    }
  }, intervalMs);
  timer.unref();
  return timer;
}
