import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { Spinner } from './design/ui.js';
import { Login } from './pages/Login.js';
import { Setup } from './pages/Setup.js';
import { Welcome } from './pages/Welcome.js';
/* Lazy, and deliberately so: the studio pulls in a PDF writer, and nobody
   opening the pipeline should pay for it. */
const BusinessCard = lazy(() => import('./pages/BusinessCard.js').then((m) => ({ default: m.BusinessCard })));
import { ChangePassword } from './pages/ChangePassword.js';
import { Dashboard } from './pages/Dashboard.js';
import { Pipeline } from './pages/Pipeline.js';
import { Inbox } from './pages/Inbox.js';
import { Contacts } from './pages/Contacts.js';
import { ContactDetail } from './pages/ContactDetail.js';
import { Tasks } from './pages/Tasks.js';
import { Library } from './pages/Library.js';
import { Offers } from './pages/Offers.js';
import { Automations } from './pages/Automations.js';
import { Settings } from './pages/Settings.js';
import { Components } from './pages/Components.js';
import { NotFound } from './pages/NotFound.js';
import { LoginLink } from './pages/LoginLink.js';
import { MyLeads } from './pages/MyLeads.js';
import { ImportDetailScreen, Imports, ImportWizard } from './pages/Imports.js';
import { Incoming } from './pages/Incoming.js';
import { Pool } from './pages/Pool.js';
import { EmailCampaigns } from './pages/EmailCampaigns.js';
import { TeamActivity } from './pages/TeamActivity.js';
import { Attendance } from './pages/Attendance.js';
import { AuditLog } from './pages/AuditLog.js';
import { Profile } from './pages/Profile.js';
import { Wall } from './pages/Wall.js';

/** Everything behind the login, with the temporary-password gate in front. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  /* First sign-in, and they have neither finished the welcome nor put it off.
     Before the shell renders, so nobody sees the dashboard flash past on
     their first morning. */
  if (user.needsWelcome) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user && !user.mustChangePassword) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        {/* Where an emailed sign-in link lands. Not wrapped in PublicOnly:
            following the link while already signed in should spend it and
            land on the dashboard, not bounce without explanation. */}
        <Route path="/login/link" element={<LoginLink />} />
        {/* First run only. The server refuses once an account exists, and the
            page sends you to /login when it sees that. */}
        <Route path="/setup" element={<Setup />} />
        <Route path="/change-password" element={<ChangePassword />} />
        {/* Full screen, outside the shell. Not wrapped in Protected: Protected
            is what sends people here, so wrapping it would loop. */}
        <Route path="/welcome" element={<Welcome />} />
        {/* One shell around every signed-in screen, as the design has it. */}
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/inbox" element={<Inbox />} />
          {/*
            * My Leads replaces Contacts as the list an agent works from.
            * /contacts still resolves — it is in bookmarks, in old push
            * notifications and in emails already sent — and lands here.
            */}
          <Route path="/leads" element={<MyLeads />} />
          <Route path="/contacts" element={<Navigate to="/leads" replace />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/projects" element={<Library />} />
          <Route path="/offers" element={<Offers />} />
          {/*
            * Lists and Campaigns are off the CRM (Emir, Nov 4, 2026: "here is
            * 2 part we no need"). The addresses still answer, because they are
            * in bookmarks and in links we already sent, and they land on the
            * dashboard rather than on a screen nobody can reach from the menu.
            * The screens, the API and the saved rows are all still here, so
            * bringing them back is putting the nav entries back.
            */}
          <Route path="/lists" element={<Navigate to="/dashboard" replace />} />
          <Route path="/lists/:id" element={<Navigate to="/dashboard" replace />} />
          <Route path="/campaigns" element={<Navigate to="/dashboard" replace />} />
          <Route path="/campaigns/:id" element={<Navigate to="/dashboard" replace />} />
          <Route path="/campaigns/:id/dial" element={<Navigate to="/dashboard" replace />} />
          <Route path="/email-campaigns" element={<EmailCampaigns />} />
          <Route path="/wall" element={<Wall />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/:userId" element={<Profile />} />
          <Route path="/team-activity" element={<TeamActivity />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/imports/new" element={<ImportWizard />} />
          <Route path="/imports/:id" element={<ImportDetailScreen />} />
          <Route path="/incoming" element={<Incoming />} />
          <Route path="/pool" element={<Pool />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/settings" element={<Settings />} />
          {/* The design-system workbench. Owner only, deliberately not in the nav. */}
          {/*
            * The Business Card Studio lives inside the shell rather than on a
            * page of its own. It was standalone at first — it holds no CRM
            * data, so it could be — but an agent who opens it is in the middle
            * of a working day, and a page with no way back to their leads is a
            * page they have to use the browser's back button to escape.
            */}
          <Route
            path="/tools/business-card"
            element={<Suspense fallback={null}><BusinessCard /></Suspense>}
          />
          <Route path="/dev/components" element={<Components />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* Keep the old board URL working for anyone who bookmarked it. */}
        <Route path="/board" element={<Navigate to="/pipeline" replace />} />
        {/* Inside the shell, so a mistyped address still has the nav on it. */}
        <Route element={<Layout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
