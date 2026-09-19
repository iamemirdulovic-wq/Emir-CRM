import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.js';
import { Layout } from './components/Layout.js';
import { Spinner } from './design/ui.js';
import { Login } from './pages/Login.js';
import { Setup } from './pages/Setup.js';
import { ChangePassword } from './pages/ChangePassword.js';
import { Dashboard } from './pages/Dashboard.js';
import { Pipeline } from './pages/Pipeline.js';
import { Inbox } from './pages/Inbox.js';
import { Contacts } from './pages/Contacts.js';
import { ContactDetail } from './pages/ContactDetail.js';
import { Tasks } from './pages/Tasks.js';
import { Library } from './pages/Library.js';
import { Automations } from './pages/Automations.js';
import { Settings } from './pages/Settings.js';
import { ImportDetailScreen, Imports, ImportWizard } from './pages/Imports.js';
import { ListDetail, Lists } from './pages/Lists.js';
import { CampaignDetailScreen, Campaigns, Dialler } from './pages/Campaigns.js';
import { Pool } from './pages/Pool.js';

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
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/projects" element={<Library />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<ListDetail />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:id" element={<CampaignDetailScreen />} />
          <Route path="/campaigns/:id/dial" element={<Dialler />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/imports/new" element={<ImportWizard />} />
          <Route path="/imports/:id" element={<ImportDetailScreen />} />
          <Route path="/pool" element={<Pool />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {/* Keep the old board URL working for anyone who bookmarked it. */}
        <Route path="/board" element={<Navigate to="/pipeline" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  );
}
