import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.js';
import { Shell } from './components/Shell.js';
import { Spinner } from './components/ui.js';
import { Login } from './pages/Login.js';
import { ChangePassword } from './pages/ChangePassword.js';
import { Board } from './pages/Board.js';
import { Inbox } from './pages/Inbox.js';
import { Contacts } from './pages/Contacts.js';
import { ContactDetail } from './pages/ContactDetail.js';
import { Projects } from './pages/Projects.js';
import { Templates } from './pages/Templates.js';
import { Reports } from './pages/Reports.js';
import { Team } from './pages/Team.js';
import type { ReactNode } from 'react';

/** Everything behind the login, with the temporary-password gate in front. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Loading…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Shell>{children}</Shell>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user && !user.mustChangePassword) return <Navigate to="/board" replace />;
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
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route
          path="/board"
          element={
            <Protected>
              <Board />
            </Protected>
          }
        />
        <Route
          path="/inbox"
          element={
            <Protected>
              <Inbox />
            </Protected>
          }
        />
        <Route
          path="/contacts"
          element={
            <Protected>
              <Contacts />
            </Protected>
          }
        />
        <Route
          path="/contacts/:id"
          element={
            <Protected>
              <ContactDetail />
            </Protected>
          }
        />
        <Route
          path="/projects"
          element={
            <Protected>
              <Projects />
            </Protected>
          }
        />
        <Route
          path="/templates"
          element={
            <Protected>
              <Templates />
            </Protected>
          }
        />
        <Route
          path="/reports"
          element={
            <Protected>
              <Reports />
            </Protected>
          }
        />
        <Route
          path="/team"
          element={
            <Protected>
              <Team />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </AuthProvider>
  );
}
