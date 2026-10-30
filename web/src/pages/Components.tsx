import { useState } from 'react';
import {
  Badge, BottomSheet, BudgetRange, Button, Combobox, ConfirmDialog, CountdownRing, CurrencyInput,
  Icon, IconButton, PhoneInput, Skeleton, SkeletonRows, StatCard, Tabs, TimelineItem, WhenField,
} from '../design/index.js';
import {
  Avatar, Chip, Empty, ErrorNote, Field, Note, Panel, Score, StagePill, Tag, useToast,
} from '../design/ui.js';
import { useAuth } from '../lib/auth.js';

/**
 * Every component in one place, so a change to the design system can be seen
 * rather than guessed at.
 *
 * Owner only, and not in the navigation: it is a workbench, not a feature.
 * Open it at /dev/components.
 */
export function Components() {
  const { user } = useAuth();
  const toast = useToast();

  const [phone, setPhone] = useState('');
  const [budget, setBudget] = useState<number | null>(2_500_000);
  const [range, setRange] = useState<[number | null, number | null]>([1_000_000, 5_000_000]);
  const [project, setProject] = useState('');
  const [when, setWhen] = useState('');
  const [tab, setTab] = useState<'today' | 'new' | 'overdue'>('today');
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [typeConfirm, setTypeConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  /* A fresh five minutes on every reload, so the ring can be watched turn
     amber and then red without waiting for a real lead. */
  const [deadline] = useState(() => new Date(Date.now() + 5 * 60 * 1000));

  if (user?.role !== 'owner' && user?.role !== 'admin') {
    return <ErrorNote>This page is for the owner.</ErrorNote>;
  }

  return (
    <section id="components" className="kit-demo">
      <Panel span={12} index={0} icon="layout-grid" title="Buttons">
        <div className="kit-row">
          <Button variant="primary" icon="phone">Accept &amp; call</Button>
          <Button icon="message-square">WhatsApp</Button>
          <Button variant="whatsapp" icon="message-circle">Send</Button>
          <Button variant="ghost" icon="pencil">Edit</Button>
          <Button variant="danger" icon="trash-2">Delete</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => {
              setSaving(true);
              window.setTimeout(() => {
                setSaving(false);
                toast('Saved');
              }, 1400);
            }}
          >
            Click to load
          </Button>
        </div>
        <div className="kit-row">
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg">Large</Button>
          <IconButton icon="phone" label="Call" />
          <IconButton icon="star" label="Star" variant="primary" />
        </div>
      </Panel>

      <Panel span={6} index={1} icon="id-card" title="Inputs">
        <PhoneInput value={phone} onChange={(value) => setPhone(value)} required />
        <Note>Sends <code>{phone || '(nothing yet)'}</code> to the server.</Note>

        <Field label="Budget">
          <CurrencyInput value={budget} onChange={setBudget} />
        </Field>

        <Field label="Project">
          <Combobox
            allowFree
            value={project}
            onChange={setProject}
            placeholder="Search the library, or type it"
            options={[
              { value: '1', label: 'Sobha Hartland II', hint: 'Sobha · Mohammed Bin Rashid City' },
              { value: '2', label: 'Emaar Beachfront', hint: 'Emaar · Dubai Harbour' },
              { value: '3', label: 'Yas Riva Reserve', hint: 'Aldar · Yas Island' },
              { value: '4', label: 'Binghatti Starfall', hint: 'Binghatti · Business Bay' },
            ]}
          />
        </Field>

        <Field label="Budget range">
          <BudgetRange min={range[0]} max={range[1]} onChange={(low, high) => setRange([low, high])} />
        </Field>

        <Field label="Call back when?">
          <WhenField value={when} onChange={setWhen} />
        </Field>
      </Panel>

      <Panel span={6} index={2} icon="activity" title="Status and feedback">
        <div className="kit-row kit-centre">
          <CountdownRing deadline={deadline} />
          <CountdownRing deadline={new Date(Date.now() + 95 * 1000)} size={92} />
          <CountdownRing deadline={new Date(Date.now() + 40 * 1000)} size={92} />
        </div>

        <div className="kit-row">
          <StagePill stage="new_lead" label="New lead" />
          <StagePill stage="attempted_contact" label="Attempted" />
          <StagePill stage="engaged_qualified" label="Engaged" />
          <StagePill stage="won" label="Won" />
          <StagePill stage="lost" label="Lost" />
        </div>

        <div className="kit-row">
          <Score value={82} /><Score value={48} /><Score value={11} />
          <Tag>src:meta</Tag><Tag>proj:sobha</Tag>
          <span>Unread <Badge count={7} /></span>
          <span>Overdue <Badge count={128} /></span>
          <Avatar name="Sara Al Mansoori" /><Avatar name="Omar Farouk" />
        </div>

        <div className="kit-row">
          <Chip icon="flame" on>Hot</Chip>
          <Chip icon="clock-3">Warm</Chip>
          <Chip>Cold</Chip>
        </div>
      </Panel>

      <Panel span={6} index={3} icon="bar-chart-3" title="Stat cards">
        <div className="kit-stats">
          <StatCard icon="user-plus" label="New leads today" value={19} trend={-14} hint="vs yesterday" />
          <StatCard icon="timer" label="My response time" value="1m 40s" tone="good" hint="target 5m" />
          <StatCard icon="calendar-check" label="Follow-ups today" value={4} tone="warn" onClick={() => toast('Opens the list')} />
          <StatCard icon="trophy" label="Deals won" value={2} suffix="this month" tone="good" />
        </div>
      </Panel>

      <Panel span={6} index={4} icon="list" title="Tabs, timeline, empty and loading">
        <Tabs
          label="Example"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'today', label: 'Follow-up today', count: 4 },
            { value: 'new', label: 'New', count: 12 },
            { value: 'overdue', label: 'Overdue', count: 3, alarm: true },
          ]}
        />

        <ul className="kit-timeline">
          <TimelineItem icon="phone" tone="good" title="Sara called — talked, interested" meta="Today · 14:05" />
          <TimelineItem icon="message-circle" tone="whatsapp" title="WhatsApp sent" meta="Today · 14:06">
            Hi Ahmed, this is Sara from Emigeo Homes 👋
          </TimelineItem>
          <TimelineItem icon="undo-2" tone="bad" title="Bounced from Omar — no response in 5 minutes" meta="Today · 09:12" />
          <TimelineItem icon="mail" title="Email “Sobha brochure” opened" meta="Yesterday · 18:40 · 2×" />
        </ul>

        <SkeletonRows rows={3} />
        <Empty icon="inbox" title="Inbox zero! 🎉" hint="Every lead has an owner." />
        <div className="kit-row">
          <Skeleton width={120} /><Skeleton width={80} height={28} radius={999} />
        </div>
      </Panel>

      <Panel span={12} index={5} icon="layers" title="Sheets and dialogs">
        <div className="kit-row">
          <Button onClick={() => setSheet(true)}>Open bottom sheet</Button>
          <Button onClick={() => setConfirm(true)}>Confirm</Button>
          <Button variant="danger" onClick={() => setTypeConfirm(true)}>Confirm by typing</Button>
          <Button onClick={() => toast('Lead marked Lost · Undo')}>Toast</Button>
        </div>
      </Panel>

      <BottomSheet
        open={sheet}
        title="How did the call go?"
        onClose={() => setSheet(false)}
        footer={<Button variant="ghost" block onClick={() => setSheet(false)}>Not now</Button>}
      >
        <Button variant="primary" block icon="check-circle-2" onClick={() => setSheet(false)}>Talked — interested</Button>
        <Button block icon="clock-3" onClick={() => setSheet(false)}>Talked — not now</Button>
        <Button block icon="phone-outgoing" onClick={() => setSheet(false)}>No answer</Button>
        <Button block icon="circle-x" onClick={() => setSheet(false)}>Wrong number</Button>
      </BottomSheet>

      <ConfirmDialog
        open={confirm}
        title="Log everyone out?"
        body="Every agent will have to sign in again. Anything they were typing is kept."
        confirmLabel="Log everyone out"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          toast('Nothing happened — this is the workbench');
        }}
      />

      <ConfirmDialog
        open={typeConfirm}
        danger
        title="Delete 128 leads?"
        typeToConfirm="DELETE"
        body={
          <>
            This cannot be undone from the screen.
            <ul>
              <li>The leads and their notes stop being visible</li>
              <li>Their history stays in the audit log</li>
            </ul>
          </>
        }
        confirmLabel="Delete them"
        onCancel={() => setTypeConfirm(false)}
        onConfirm={() => {
          setTypeConfirm(false);
          toast('Nothing happened — this is the workbench');
        }}
      />
    </section>
  );
}
