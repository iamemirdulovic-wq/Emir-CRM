import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { Spinner } from './design/ui.js';
import { Login } from './pages/Login.js';
import { Setup } from './pages/Setup.js';
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
import { MyLeads } from './pages/MyLeads.js';
import { ImportDetailScreen, Imports, ImportWizard } from './pages/Imports.js';
import { ListDetail, Lists } from './pages/Lists.js';
import { CampaignDetailScreen, Campaigns, Dialler } from './pages/Campaigns.js';
import { Incoming } from './pages/Incoming.js';
import { Pool } from './pages/Pool.js';
import { EmailCampaigns } from './pages/EmailCampaigns.js';
import { TeamActivity } from './pages/TeamActivity.js';
import { AuditLog } from './pages/AuditLog.js';
import { Profile } from './pages/Profile.js';
import { Wall } from './pages/Wall.js';

/** Everything behind the login, with the temporary-password gate in front. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
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
        {/* First run only. The server refuses once an account exists, and the
            page sends you to /login when it sees that. */}
        <Route path="/setup" element={<Setup />} />
        <Route path="/change-password" element={<ChangePassword />} />
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
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<ListDetail />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetailScreen />} />
          <Route path="/campaigns/:id/dial" element={<Dialler />} />
          <Route path="/email-campaigns" element={<EmailCampaigns />} />
          <Route path="/wall" element={<Wall />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/profile/:userId" element={<Profile />} />
          <Route path="/team-activity" element={<TeamActivity />} />
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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
