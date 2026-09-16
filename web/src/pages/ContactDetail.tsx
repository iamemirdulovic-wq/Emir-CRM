import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { budgetLabel, formatDateTime, humanize, relativeTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { Contact360 } from '../lib/types.js';
import { Avatar, EmptyState, ErrorNote, Icon, Modal, ScoreChip, Spinner, StageChip, Tag, Toast } from '../components/ui.js';

/** Contact 360: everything known about one person, and the quick actions. */
export function ContactDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const detail = useAsync<Contact360>(() => api.get(`/api/contacts/${id}`), [id]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [dncOpen, setDncOpen] = useState(false);
  const [note, setNote] = useState('');
  const [dncReason, setDncReason] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const flash = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  };

  if (detail.error) return <ErrorNote message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Spinner label={t('loading')} />;

  const { contact, opportunities, activities, tasks, tags, consents, conversation, aiSuggestions } = detail.data;
  const primary = opportunities[0];

  const addNote = async () => {
    try {
      await api.post(`/api/contacts/${id}/notes`, { body: note });
      setNote('');
      setNoteOpen(false);
      detail.reload();
      flash('Note added');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not add the note', 'error');
    }
  };

  const addDnc = async () => {
    try {
      await api.post(`/api/contacts/${id}/dnc`, { reason: dncReason });
      setDncReason('');
      setDncOpen(false);
      detail.reload();
      flash('Added to the do-not-contact list');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="card p-4">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={contact.full_name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-900">{contact.full_name ?? 'Unnamed contact'}</h1>
              <ScoreChip score={contact.lead_score} />
              {contact.dnc === 1 ? <span className="chip bg-rose-100 text-rose-700">Do not contact</span> : null}
              {primary ? <StageChip stage={primary.stage_key} /> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              {contact.phone_e164 ? (
                <a className="flex items-center gap-1 hover:text-brand-700" href={`tel:${contact.phone_e164}`}>
                  <Icon name="call" className="!text-[16px]" />
                  {contact.phone_e164}
                </a>
              ) : null}
              {contact.email ? (
                <a className="flex items-center gap-1 hover:text-brand-700" href={`mailto:${contact.email}`}>
                  <Icon name="mail" className="!text-[16px]" />
                  {contact.email}
                </a>
              ) : null}
              <span className="flex items-center gap-1">
                <Icon name="person" className="!text-[16px]" />
                {contact.owner_name ?? 'Unassigned'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {conversation ? (
              <Link to={`/inbox?conversation=${conversation.id}`} className="btn-tonal">
                <Icon name="forum" className="!text-[18px]" />
                Open thread
              </Link>
            ) : null}
            <button type="button" className="btn-ghost" onClick={() => setNoteOpen(true)}>
              <Icon name="note_add" className="!text-[18px]" />
              Note
            </button>
            {contact.dnc !== 1 ? (
              <button type="button" className="btn-ghost text-rose-700" onClick={() => setDncOpen(true)}>
                <Icon name="block" className="!text-[18px]" />
                DNC
              </button>
            ) : null}
          </div>
        </div>

        {tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Tag key={tag} value={tag} />
            ))}
          </div>
        ) : null}

        {contact.ai_summary ? (
          <div className="mt-3 rounded-lg bg-brand-50 p-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-brand-800">
              <Icon name="auto_awesome" className="!text-[15px]" />
              AI summary
            </p>
            <p className="whitespace-pre-wrap text-sm text-brand-900">{contact.ai_summary}</p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Opportunities</h2>
            {opportunities.length === 0 ? (
              <EmptyState icon="inventory_2" title="No opportunities yet" />
            ) : (
              <ul className="space-y-3">
                {opportunities.map((opportunity) => (
                  <li key={opportunity.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StageChip stage={opportunity.stage_key} />
                      {opportunity.sub_status ? (
                        <span className="chip bg-slate-100 text-slate-600">{humanize(String(opportunity.sub_status))}</span>
                      ) : null}
                      {opportunity.status === 'lost' && opportunity.lost_reason ? (
                        <span className="chip bg-rose-100 text-rose-700">{humanize(String(opportunity.lost_reason))}</span>
                      ) : null}
                      <span className="ms-auto text-xs text-slate-400">{relativeTime(String(opportunity.created_at))}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                      <Field label={t('project')} value={opportunity.project_name as string | null} />
                      <Field
                        label={t('budget')}
                        value={budgetLabel(
                          opportunity.budget_min_aed as number | null,
                          opportunity.budget_max_aed as number | null,
                          opportunity.budget_band as string | null,
                        )}
                      />
                      <Field label="Unit" value={opportunity.unit_type as string | null} />
                      <Field label="Timeline" value={humanize(opportunity.timeline as string)} />
                      <Field label="Purpose" value={humanize(opportunity.purpose as string)} />
                      <Field label={t('source')} value={humanize(opportunity.source as string)} />
                      {opportunity.campaign_name ? (
                        <Field label="Campaign" value={opportunity.campaign_name as string} />
                      ) : null}
                      {opportunity.golden_visa_interest === 1 ? <Field label="Golden Visa" value="Interested" /> : null}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('activity')}</h2>
            {activities.length === 0 ? (
              <EmptyState icon="history" title="Nothing recorded yet" />
            ) : (
              <ol className="space-y-3">
                {activities.map((activity) => (
                  <li key={activity.id} className="flex gap-3">
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Icon name={activityIcon(activity.type)} className="!text-[16px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800">{activity.title}</p>
                      {activity.body ? (
                        <p className="whitespace-pre-wrap text-xs text-slate-500">{activity.body}</p>
                      ) : null}
                      <p className="text-[11px] text-slate-400">
                        {formatDateTime(activity.created_at)}
                        {activity.user_name ? ` · ${activity.user_name}` : ' · system'}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('tasks')}</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400">No tasks.</p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2">
                    <button
                      type="button"
                      className="mt-0.5"
                      aria-label="Complete task"
                      disabled={Boolean(task.completed_at)}
                      onClick={async () => {
                        await api.post(`/api/contacts/tasks/${task.id}/complete`);
                        detail.reload();
                      }}
                    >
                      <Icon
                        name={task.completed_at ? 'check_circle' : 'radio_button_unchecked'}
                        className={`!text-[18px] ${task.completed_at ? 'text-emerald-600' : 'text-slate-400'}`}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${task.completed_at ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {task.title}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {task.priority === 'urgent' ? '🔴 ' : ''}
                        {relativeTime(task.due_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Consent</h2>
            {consents.length === 0 ? (
              <p className="text-sm text-slate-400">No consent recorded.</p>
            ) : (
              <ul className="space-y-2">
                {consents.map((consent, index) => (
                  <li key={index} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Icon
                        name={consent.granted ? 'check_circle' : 'cancel'}
                        className={`!text-[16px] ${consent.granted ? 'text-emerald-600' : 'text-rose-500'}`}
                      />
                      <span className="capitalize text-slate-700">{consent.channel}</span>
                      <span className="text-xs text-slate-400">via {humanize(consent.source)}</span>
                    </div>
                    {consent.consent_text ? (
                      <p className="ms-6 mt-0.5 text-[11px] italic text-slate-500">“{consent.consent_text}”</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {aiSuggestions.length > 0 ? (
            <section className="card p-4">
              <h2 className="mb-3 flex items-center gap-1 text-sm font-semibold text-slate-900">
                <Icon name="auto_awesome" className="!text-[16px] text-brand-600" />
                AI-filled fields
              </h2>
              <ul className="space-y-1.5">
                {aiSuggestions.map((suggestion) => (
                  <li key={suggestion.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-600">{humanize(suggestion.field)}</span>
                    <span className="chip bg-brand-50 text-brand-700">{suggestion.value}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">Confirm these against what the lead actually said.</p>
            </section>
          ) : null}
        </div>
      </div>

      <Modal
        open={noteOpen}
        title="Add a note"
        onClose={() => setNoteOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setNoteOpen(false)}>
              {t('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={!note.trim()} onClick={() => void addNote()}>
              {t('save')}
            </button>
          </>
        }
      >
        <textarea className="field" rows={5} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Modal>

      <Modal
        open={dncOpen}
        title="Add to do-not-contact"
        onClose={() => setDncOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDncOpen(false)}>
              {t('cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={!dncReason.trim()} onClick={() => void addDnc()}>
              Add to DNC
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          No further automated messages will be sent, on any channel. This also suppresses the number and email address.
        </p>
        <label className="label" htmlFor="dnc-reason">
          Reason
        </label>
        <input id="dnc-reason" className="field" value={dncReason} onChange={(e) => setDncReason(e.target.value)} autoFocus />
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}

function activityIcon(type: string): string {
  if (type.startsWith('message')) return 'chat';
  if (type.startsWith('stage')) return 'moving';
  if (type.startsWith('lead.assigned')) return 'person_add';
  if (type.startsWith('sla')) return 'timer_off';
  if (type.startsWith('intent')) return 'psychology';
  if (type === 'note') return 'sticky_note_2';
  if (type.startsWith('contact.dnc')) return 'block';
  if (type.startsWith('brochure')) return 'picture_as_pdf';
  return 'circle';
}
