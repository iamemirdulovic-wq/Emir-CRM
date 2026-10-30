import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Button } from '../design/forms.js';
import { Icon, SkeletonRows } from '../design/index.js';
import {
  Avatar, Chip, Empty, ErrorNote, Field, Panel, Seg, TextArea, Toolbar, useToast,
} from '../design/ui.js';
import { formatDateTime, humanize, relativeTime } from '../lib/format.js';
import { ConfirmDialog } from '../design/feedback.js';

/**
 * Who is working.
 *
 * Owner and manager only, and a manager sees their own team. Where a
 * colleague signed in from is personal data about them, not a company
 * noticeboard — so this is a screen for the person responsible for the
 * account, not for everyone.
 */

interface LiveMember {
  userId: string;
  name: string;
  role: string;
  availability: string;
  device: string | null;
  where: string | null;
  doing: string | null;
  live: boolean;
  lastSeen: string;
}

interface SessionRow {
  id: string;
  name: string;
  device: string | null;
  where: string | null;
  level: 'none' | 'info' | 'watch' | 'alarm';
  flags: Array<{ key: string; level: string; message: string }>;
  signedInAt: string;
  signedOutAt: string | null;
  activeMinutes: number;
}

const SCREEN_NAMES: Record<string, string> = {
  '/leads': 'My Leads',
  '/pipeline': 'Pipeline',
  '/inbox': 'Inbox',
  '/tasks': 'Tasks',
  '/dashboard': 'Dashboard',
  '/projects': 'Projects',
  '/offers': 'Sales offers',
  '/incoming': 'Incoming',
  '/settings': 'Settings',
};

function screenName(path: string | null): string | null {
  if (!path) return null;
  const match = Object.keys(SCREEN_NAMES).find((key) => path.startsWith(key));
  if (match) return SCREEN_NAMES[match] ?? null;
  if (path.startsWith('/contacts/')) return 'A lead';
  return null;
}

export function TeamActivity() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'live' | 'sessions'>('live');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [signingOut, setSigningOut] = useState<LiveMember | null>(null);
  const [reason, setReason] = useState('');

  /* Ten seconds. Live is the point of the screen, and a page that needs a
     refresh to show who is on is not showing who is on. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tab !== 'live') return undefined;
    const timer = window.setInterval(() => setTick((n) => n + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  const live = useAsync<{ items: LiveMember[] }>(
    () => api.get('/api/activity/team'),
    [reloadKey, tab, tick],
  );

  const sessions = useAsync<{ items: SessionRow[] }>(
    () => api.get(`/api/activity/sessions${onlyFlagged ? '?flagged=1' : ''}`),
    [onlyFlagged, reloadKey, tab],
  );

  async function forceSignOut() {
    if (!signingOut) return;
    try {
      const result = await api.post<{ endedSessions: number; name: string }>(
        `/api/activity/sign-out/${signingOut.userId}`,
        { reason },
      );
      toast(`${result.name} has been signed out everywhere`);
      setSigningOut(null);
      setReason('');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work');
    }
  }

  const members = live.data?.items ?? [];
  const onNow = members.filter((member) => member.live);

  return (
    <>
      <Toolbar
        right={
          <Seg
            value={tab}
            options={[
              { value: 'live', label: 'Live now' },
              { value: 'sessions', label: 'Sign-ins' },
            ]}
            onChange={setTab}
          />
        }
      >
        <Chip on icon="users-round">Team activity</Chip>
      </Toolbar>

      {live.error && <ErrorNote>{live.error}</ErrorNote>}

      {tab === 'live' && (
        <Panel index={1} icon="radio" title={`On right now (${onNow.length})`}>
          {!live.data && <SkeletonRows rows={4} />}
          {live.data && members.length === 0 && (
            <Empty icon="users-round" title="Nobody is signed in" hint="Sessions appear here as people sign in." />
          )}

          <ul className="live-list">
            {members.map((member) => (
              <li key={member.userId} className={member.live ? 'live-row on' : 'live-row'}>
                <Avatar name={member.name} />
                <span className="live-who">
                  <b>{member.name}</b>
                  <small>
                    {humanize(member.role)}
                    {member.device ? ` · ${member.device}` : ''}
                    {member.where ? ` · ${member.where}` : ''}
                  </small>
                </span>

                <span className="live-doing">
                  {member.live ? (
                    <>
                      <span className="live-dot" aria-hidden />
                      {screenName(member.doing) ?? 'In the CRM'}
                    </>
                  ) : (
                    member.lastSeen
                  )}
                </span>

                {user?.role === 'owner' || user?.role === 'admin' ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setSigningOut(member)}
                    title="End every session this person has"
                  >
                    <Icon name="log-out" size={14} />
                    Sign out
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tab === 'sessions' && (
        <Panel
          index={1}
          icon="shield"
          title="Sign-ins"
        >
          <div className="chip-row" style={{ marginBottom: 10 }}>
            <Chip on={onlyFlagged} icon="alert-triangle" onClick={() => setOnlyFlagged((on) => !on)}>
              Only the unusual ones
            </Chip>
          </div>

          {!sessions.data && <SkeletonRows rows={5} />}
          {sessions.data && sessions.data.items.length === 0 && (
            <Empty
              icon="shield-check"
              title={onlyFlagged ? 'Nothing unusual' : 'No sign-ins recorded yet'}
              hint={onlyFlagged
                ? 'Every sign-in has been from a known device in a known place.'
                : 'They appear here as people sign in.'}
            />
          )}

          <ul className="signin-list">
            {sessions.data?.items.map((row) => (
              <li key={row.id} className={`signin ${row.level}`}>
                <div className="signin-head">
                  <b>{row.name}</b>
                  <span className="muted">
                    {row.device ?? 'Unknown device'}
                    {row.where ? ` · ${row.where}` : ''}
                  </span>
                  <time dateTime={row.signedInAt} title={formatDateTime(row.signedInAt)}>
                    {relativeTime(row.signedInAt)}
                  </time>
                </div>

                {row.flags.length > 0 && (
                  <ul className="signin-flags">
                    {row.flags.map((flag) => (
                      <li key={flag.key} className={flag.level}>
                        <Icon
                          name={flag.level === 'alarm' ? 'alert-triangle' : 'info'}
                          size={13}
                        />
                        {flag.message}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="signin-foot muted">
                  {row.activeMinutes > 0
                    ? `${row.activeMinutes} min of actual use`
                    : 'No activity recorded'}
                  {row.signedOutAt ? ' · signed out' : ' · still open'}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <ConfirmDialog
        open={signingOut !== null}
        title={`Sign ${signingOut?.name ?? ''} out everywhere?`}
        confirmLabel="Sign them out"
        danger
        onCancel={() => {
          setSigningOut(null);
          setReason('');
        }}
        onConfirm={() => void forceSignOut()}
        confirmDisabled={reason.trim().length < 3}
        body={
          <>
            <p>
              Every device they are signed in on will be signed out immediately. They can sign back
              in with their password, so this does not lock them out — use the Users page for that.
            </p>
            <Field label="Why?" hint="Recorded in the audit log. They will ask.">
              <TextArea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Lost phone"
              />
            </Field>
          </>
        }
      />
    </>
  );
}
