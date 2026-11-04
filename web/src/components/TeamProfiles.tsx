/**
 * Everybody's profile and everybody's welcome answers, on one screen.
 *
 * Emir asked, Nov 4 2026, to be able to see what the team wrote: how far
 * through their profile each person is, and what they said on their first
 * sign-in about the year, the dream and the five years. Two reasons it is
 * worth a screen rather than a report:
 *
 * **A half-finished profile is a worse business card.** Every offer and every
 * email carries the agent's photo, title and phone, and the people who never
 * filled theirs in are exactly the ones nobody notices.
 *
 * **The answers are only useful if somebody reads them.** They were asked for
 * a reason, and the agents are told in the flow itself that the owner will
 * read them, so this screen is the promise being kept rather than a surprise.
 *
 * Owner and admin only. The server checks the role on `/api/onboarding/all`;
 * hiding the tab is a convenience, not the control.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { Icon } from '../design/index.js';
import { Avatar, Chip, Empty, ErrorNote, Panel, Toolbar, Spinner } from '../design/ui.js';

interface Question {
  id: string;
  emoji: string;
  prompt: string;
}

interface Person {
  userId: string;
  name: string;
  preferredName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  jobTitle: string | null;
  photoUrl: string | null;
  headline: string | null;
  /** How many of the profile fields they have filled in, out of how many. */
  profileFilled: number;
  profileTotal: number;
  /** Which ones are still empty, named so the screen can say what to chase. */
  profileMissing: string[];
  answers: Record<string, string>;
  completedAt: string | null;
  skippedAt: string | null;
}

type Filter = 'all' | 'waiting' | 'answered';

/** Where someone has got to, as one word and one colour. */
function welcomeState(person: Person): { label: string; tone: string } {
  if (person.completedAt) return { label: 'Answered', tone: 'ok' };
  if (Object.keys(person.answers).length > 0) return { label: 'Part way', tone: 'part' };
  if (person.skippedAt) return { label: 'Skipped', tone: 'skip' };
  return { label: 'Not started', tone: 'none' };
}

export function TeamProfiles() {
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const state = useAsync<{ questions: Question[]; items: Person[] }>(
    () => api.get('/api/onboarding/all'),
    [],
  );

  const questions = state.data?.questions ?? [];
  const everyone = useMemo(() => state.data?.items ?? [], [state.data]);

  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    return everyone.filter((person) => {
      if (filter === 'answered' && !person.completedAt) return false;
      if (filter === 'waiting' && person.completedAt) return false;
      if (!needle) return true;
      return [person.name, person.email, person.jobTitle ?? '', person.role]
        .join(' ').toLowerCase().includes(needle);
    });
  }, [everyone, filter, find]);

  const answered = everyone.filter((person) => person.completedAt).length;
  const halfDone = everyone.filter((person) => person.profileFilled < person.profileTotal).length;

  return (
    <>
      <Toolbar
        right={
          <span className="tp-find">
            <Icon name="search" size={16} />
            <input
              className="input"
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="A name or an email"
              aria-label="Find someone"
            />
          </span>
        }
      >
        <Chip on={filter === 'all'} icon="users" onClick={() => setFilter('all')}>
          Everyone ({everyone.length})
        </Chip>
        <Chip on={filter === 'answered'} icon="check" onClick={() => setFilter('answered')}>
          Answered ({answered})
        </Chip>
        <Chip on={filter === 'waiting'} icon="hourglass" onClick={() => setFilter('waiting')}>
          Still waiting ({everyone.length - answered})
        </Chip>
      </Toolbar>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {!state.data && <Spinner />}

      {state.data && (
        <Panel index={0} icon="id-card" title="Where the team has got to">
          <p className="muted tp-lede">
            {answered} of {everyone.length} have answered the welcome questions, and{' '}
            {halfDone === 0
              ? 'everyone has finished their profile.'
              : `${halfDone} ${halfDone === 1 ? 'profile is' : 'profiles are'} not finished.`}
            {' '}
            Everyone is told on their first sign-in that you read the answers.
          </p>
        </Panel>
      )}

      {state.data && shown.length === 0 && (
        <Empty
          icon="users-round"
          title="Nobody matches that"
          hint="Try a first name, or switch the filter back to Everyone."
        />
      )}

      <div className="tp-list">
        {shown.map((person, index) => {
          const welcome = welcomeState(person);
          const ring = person.profileTotal === 0
            ? 0
            : Math.round((person.profileFilled / person.profileTotal) * 100);
          const isOpen = open === person.userId;

          return (
            <Panel key={person.userId} index={index + 1}>
              <div className="tp-head">
                <Avatar name={person.name} src={person.photoUrl ?? undefined} size={52} />
                <div className="tp-who">
                  <b>
                    {person.name}
                    {person.preferredName && person.preferredName !== person.name.split(' ')[0] && (
                      <span className="tp-called"> goes by {person.preferredName}</span>
                    )}
                  </b>
                  <span className="muted">
                    {person.jobTitle || person.role}
                    {!person.isActive && ' · switched off'}
                  </span>
                  {person.headline && <span className="tp-headline">{person.headline}</span>}
                </div>

                <span className={`tp-state tp-${welcome.tone}`}>{welcome.label}</span>

                <span className="tp-ring" title={`${person.profileFilled} of ${person.profileTotal} filled in`}>
                  <b>{ring}%</b>
                  <small>profile</small>
                  <i style={{ width: `${ring}%` }} />
                </span>

                <Link className="btn" to={`/profile/${person.userId}`}>Open</Link>
              </div>

              {person.profileMissing.length > 0 && (
                <p className="tp-missing">
                  <Icon name="circle-alert" size={14} />
                  Still blank: {person.profileMissing.join(', ')}
                </p>
              )}

              {person.completedAt && (
                <button
                  type="button"
                  className="tp-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : person.userId)}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} />
                  {isOpen ? 'Hide the answers' : 'Read the answers'}
                  <small className="muted">{formatDateTime(person.completedAt)}</small>
                </button>
              )}

              {!person.completedAt && Object.keys(person.answers).length > 0 && (
                <button
                  type="button"
                  className="tp-toggle"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : person.userId)}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={15} />
                  {isOpen ? 'Hide' : `Read what they answered so far (${Object.keys(person.answers).length} of ${questions.length})`}
                </button>
              )}

              {isOpen && (
                <dl className="tp-answers">
                  {questions.map((question) => {
                    const said = person.answers[question.id];
                    if (!said) return null;
                    return (
                      <div key={question.id}>
                        <dt>
                          <span aria-hidden>{question.emoji}</span>
                          {question.prompt}
                        </dt>
                        {/* Their words, shown as they typed them. */}
                        <dd>{said}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
