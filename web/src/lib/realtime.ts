/**
 * Realtime via SSE, falling back to 4-second polling when the stream cannot be
 * established (a proxy that buffers it, or a browser without EventSource).
 */

export type RealtimeHandler = (type: string, payload: unknown) => void;

const EVENT_TYPES = [
  'message.created',
  'message.status',
  'conversation.updated',
  'opportunity.moved',
  'typing',
  'lead.assigned',
];

export type RealtimeConnection = { close: () => void; mode: () => 'sse' | 'polling' };

export function connectRealtime(onEvent: RealtimeHandler): RealtimeConnection {
  let source: EventSource | null = null;
  let pollTimer: number | null = null;
  let closed = false;
  let mode: 'sse' | 'polling' = 'sse';
  let retries = 0;

  const startPolling = () => {
    if (pollTimer !== null || closed) return;
    mode = 'polling';
    pollTimer = window.setInterval(() => onEvent('poll', null), 4000);
  };

  const stopPolling = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const connect = () => {
    if (closed || typeof EventSource === 'undefined') {
      startPolling();
      return;
    }
    source = new EventSource('/api/inbox/stream', { withCredentials: true });

    source.onopen = () => {
      retries = 0;
      mode = 'sse';
      stopPolling();
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        try {
          onEvent(type, JSON.parse((event as MessageEvent).data));
        } catch {
          onEvent(type, null);
        }
      });
    }

    source.onerror = () => {
      source?.close();
      source = null;
      if (closed) return;
      retries += 1;
      // Poll while we back off, so the UI keeps updating either way.
      startPolling();
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(retries, 5));
      window.setTimeout(connect, delay);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      source?.close();
      stopPolling();
    },
    mode: () => mode,
  };
}
