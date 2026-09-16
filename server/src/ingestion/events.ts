import { execute, isDuplicateKeyError, queryOne, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';

export type RecordedEvent = {
  id: string;
  /** True when this exact event has already been stored — a replay. */
  duplicate: boolean;
};

/**
 * Store the raw payload before anything else happens. The unique key on
 * (source, external_id) is the outermost idempotency guard: a replayed webhook
 * never reaches the rest of the pipeline.
 */
export async function recordInboundEvent(
  input: {
    source: string;
    externalId: string;
    payload: unknown;
    signatureValid: boolean;
    headers?: Record<string, unknown> | null;
  },
  exec: Executor = getPool(),
): Promise<RecordedEvent> {
  const id = newId();
  try {
    await execute(
      `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload, headers)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.source,
        input.externalId.slice(0, 191),
        input.signatureValid ? 1 : 0,
        JSON.stringify(input.payload ?? null),
        input.headers ? JSON.stringify(input.headers) : null,
      ],
      exec,
    );
    return { id, duplicate: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM inbound_events WHERE source = ? AND external_id = ?',
      [input.source, input.externalId.slice(0, 191)],
      exec,
    );
    return { id: existing?.id ?? id, duplicate: true };
  }
}

export async function markEventProcessing(id: string, exec: Executor = getPool()): Promise<void> {
  await execute(`UPDATE inbound_events SET status = 'processing' WHERE id = ?`, [id], exec);
}

export async function markEventProcessed(
  id: string,
  refs: { contactId?: string | null; opportunityId?: string | null } = {},
  exec: Executor = getPool(),
): Promise<void> {
  await execute(
    `UPDATE inbound_events
        SET status = 'processed', processed_at = NOW(3), error = NULL, contact_id = ?, opportunity_id = ?
      WHERE id = ?`,
    [refs.contactId ?? null, refs.opportunityId ?? null, id],
    exec,
  );
}

export async function markEventFailed(id: string, error: unknown, exec: Executor = getPool()): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await execute(
    `UPDATE inbound_events SET status = 'failed', processed_at = NOW(3), error = ? WHERE id = ?`,
    [message.slice(0, 2000), id],
    exec,
  );
}

export async function markEventIgnored(id: string, reason: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE inbound_events SET status = 'ignored', processed_at = NOW(3), error = ? WHERE id = ?`,
    [reason.slice(0, 2000), id],
    exec,
  );
}
