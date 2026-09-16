/** Every background job type, and the payload it carries. */
export const JOB_TYPES = [
  'meta.fetch_lead',
  'meta.backfill_form',
  'workflow.a.instant_capture',
  'workflow.a.sla_check',
  'workflow.b.step',
  'workflow.c.route_inbound',
  'whatsapp.send_template',
  'whatsapp.send_text',
  'email.send',
  'push.send',
  'lead.score',
  'ai.extract',
  'ai.summarize',
  'capi.send_event',
  'google.upload_conversion',
  'templates.sync',
  'email.imap_poll',
  'import.run_chunk',
  'campaign.send_batch',
  'list.recycle',
  'maintenance.cleanup',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

export type JobRecord = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  workflowRunId: string | null;
  contactId: string | null;
};
