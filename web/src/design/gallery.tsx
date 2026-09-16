/**
 * Design-system gallery — development only, never bundled into the app.
 *
 * It renders the shell, every chart primitive and the theme controls on one
 * page so the port can be checked side by side against the approved design at
 * design/emir-crm-design.html. The numbers below are illustrative sample data
 * for the components; nothing here is, or ever becomes, CRM data.
 *
 * Run it with `npm run dev -w @emir-crm/web` and open /design-system.html.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AppShell, type NavItem } from './AppShell.js';
import { Icon, ICON_NAMES } from './Icon.js';
import { CountUp } from './CountUp.js';
import { AreaChart, type AreaPoint } from './charts/AreaChart.js';
import { ChartDefs } from './charts/ChartDefs.js';
import { Donut } from './charts/Donut.js';
import { Funnel } from './charts/Funnel.js';
import { Gauge } from './charts/Gauge.js';
import { Heat } from './charts/Heat.js';
import { Spark } from './charts/Spark.js';
import { initTheme, useAppearance, useGlassReduced } from './theme.js';
import '../styles/index.css';

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { to: '/pipeline', label: 'Pipeline', icon: 'kanban' },
  { to: '/inbox', label: 'Inbox', icon: 'message-circle', badge: 4 },
  { to: '/contacts', label: 'Contacts', icon: 'users' },
  { to: '/tasks', label: 'Tasks', icon: 'check-square' },
  { to: '/projects', label: 'Projects', icon: 'building-2' },
  { to: '/automations', label: 'Automations', icon: 'zap' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

const AREA: AreaPoint[] = [
  18, 22, 19, 27, 24, 31, 29, 34, 30, 38, 35, 41, 37, 44,
].map((value, i) => ({
  label: `${i + 1} Sep`,
  value,
  previous: Math.round(value * 0.78),
}));

const SOURCES = [
  { label: 'Meta forms', value: 412, colour: '#0AA3BA' },
  { label: 'Click-to-WhatsApp', value: 188, colour: '#5CC4C9' },
  { label: 'Google Ads', value: 96, colour: '#9FB6C8' },
  { label: 'Website', value: 74, colour: '#C9D6E0' },
];

const FUNNEL = [
  { label: 'Leads', value: 770 },
  { label: 'Valid number', value: 612 },
  { label: 'Contacted', value: 540 },
  { label: 'Qualified', value: 198 },
  { label: 'Appointments', value: 70 },
  { label: 'Reservations', value: 12 },
];

const HOURS = ['8a', '10a', '12p', '2p', '4p', '6p', '8p', '10p', '12a', '2a', '4a', '6a'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEAT_ROWS = DAYS.map((label, r) => ({
  label,
  values: HOURS.map((_, c) => Math.max(0, Math.round(14 + 9 * Math.sin(c / 1.6) - r))),
}));

const KPIS = [
  { icon: 'user-plus', label: 'New leads today', value: 38, suffix: '', delta: '+12 vs yesterday', spark: [12, 18, 15, 22, 19, 27, 31, 38] },
  { icon: 'message-circle', label: 'Replied on WhatsApp', value: 64, suffix: '%', delta: '+6 pts this week', spark: [48, 52, 50, 55, 58, 57, 61, 64] },
  { icon: 'calendar-check', label: 'Appointments', value: 17, suffix: '', delta: '+4 vs last week', spark: [8, 9, 11, 10, 13, 12, 15, 17] },
  { icon: 'badge-check', label: 'Reservations', value: 12, suffix: '', delta: 'AED 31.4M pipeline', spark: [3, 4, 4, 6, 7, 8, 10, 12] },
] as const;

function Gallery() {
  const [available, setAvailable] = useState(true);
  const [query, setQuery] = useState('');
  const { appearance, setAppearance } = useAppearance();
  const [glassReduced, setGlassReduced] = useGlassReduced();

  return (
    <AppShell
      title="Design system"
      nav={NAV}
      mobileNav={NAV.slice(0, 4)}
      user={{ name: 'Sara Ahmed', role: 'Sales agent', initials: 'SA' }}
      onSignOut={() => undefined}
      search={{ value: query, onChange: setQuery }}
      availability={{ available, onChange: setAvailable }}
      notifications={{ unread: 3, onOpen: () => undefined }}
      action={
        <button className="btn btn-primary" type="button">
          <Icon name="plus" />
          <span>Add lead</span>
        </button>
      }
    >
      <ChartDefs />

      <div className="dash">
        {KPIS.map((kpi, i) => (
          <div className="kpi span-3 rise" key={kpi.label} style={{ ['--i' as string]: i }}>
            <div className="lbl">
              <Icon name={kpi.icon} />
              {kpi.label}
            </div>
            <div className="foot">
              <div>
                <div className="val">
                  <CountUp value={kpi.value} suffix={kpi.suffix} />
                </div>
                <div className="delta">{kpi.delta}</div>
              </div>
              <Spark values={[...kpi.spark]} />
            </div>
          </div>
        ))}

        <div className="panel span-8 rise" style={{ ['--i' as string]: 4 }}>
          <h3>
            <Icon name="activity" />
            Leads over time
            <span className="live">
              <i />
              Live
            </span>
          </h3>
          <AreaChart points={AREA} unit="leads" />
          <div className="legend">
            <span>
              <i />
              This period
            </span>
            <span>
              <i className="b" />
              Previous period
            </span>
          </div>
        </div>

        <div className="panel span-4 rise" style={{ ['--i' as string]: 5 }}>
          <h3>
            <Icon name="timer" />
            Speed to lead
          </h3>
          <Gauge value={24} max={60} footStart="0s" footEnd="60s">
            <div className="gauge-num">
              <b>
                <CountUp value={24} />s
              </b>
              <small>median first reply</small>
            </div>
          </Gauge>
        </div>

        <div className="panel span-5 rise" style={{ ['--i' as string]: 6 }}>
          <h3>
            <Icon name="pie-chart" />
            Where leads come from
          </h3>
          <Donut slices={SOURCES} centreLabel="leads this month" />
        </div>

        <div className="panel span-7 rise" style={{ ['--i' as string]: 7 }}>
          <h3>
            <Icon name="filter" />
            Funnel
          </h3>
          <Funnel steps={FUNNEL} />
        </div>

        <div className="panel span-12 rise" style={{ ['--i' as string]: 8 }}>
          <h3>
            <Icon name="radar" />
            When leads arrive
          </h3>
          <Heat hours={HOURS} rows={HEAT_ROWS} />
        </div>

        <div className="panel span-6 rise" style={{ ['--i' as string]: 9 }}>
          <h3>
            <Icon name="settings" />
            Appearance
          </h3>
          <div className="toolbar">
            {(['system', 'light', 'dark'] as const).map((option) => (
              <button
                type="button"
                key={option}
                className={appearance === option ? 'chip on' : 'chip'}
                onClick={() => setAppearance(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={glassReduced}
              onChange={(event) => setGlassReduced(event.target.checked)}
            />
            Reduce glass effect
          </label>
        </div>

        <div className="panel span-6 rise" style={{ ['--i' as string]: 10 }}>
          <h3>
            <Icon name="layers" />
            Buttons, chips and pills
          </h3>
          <div className="toolbar">
            <button className="btn" type="button">
              Secondary
            </button>
            <button className="btn btn-primary" type="button">
              <Icon name="send" />
              Primary
            </button>
            <button className="btn btn-wa" type="button">
              <Icon name="message-circle" />
              WhatsApp
            </button>
          </div>
          <div className="toolbar">
            <span className="pill ok">Received</span>
            <span className="pill wait">Awaiting</span>
            <span className="pill due">Overdue</span>
            <span className="pill info">Auto</span>
            <span className="tag">src:meta</span>
            <span className="score hot">82</span>
          </div>
        </div>

        <div className="panel span-12 rise" style={{ ['--i' as string]: 11 }}>
          <h3>
            <Icon name="layout-grid" />
            Icons ({ICON_NAMES.length})
          </h3>
          <div className="tags">
            {ICON_NAMES.map((name) => (
              <span className="tag" key={name} title={name}>
                <Icon name={name} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from design-system.html');

createRoot(container).render(
  <StrictMode>
    <MemoryRouter initialEntries={['/dashboard']}>
      <Gallery />
    </MemoryRouter>
  </StrictMode>,
);
