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
import { V2Shell, V2More } from './v2/Shell.js';
import { V2Leads } from './v2/Leads.js';
import { V2Home } from './v2/Home.js';
import { V2Calling } from './v2/Calling.js';
import { V2Incoming } from './v2/Incoming.js';
import { V2Pipeline } from './v2/Pipeline.js';
import { V2AddLead } from './v2/AddLead.js';
import { V2Attendance } from './v2/Attendance.js';
import { V2Tasks } from './v2/Tasks.js';
import { V2Calendar } from './v2/Calendar.js';
import { V2Transfers } from './v2/Transfers.js';
import { V2Team, V2Person } from './v2/Team.js';
import { V2Projects, V2Project } from './v2/Projects.js';
import { V2Wall, V2Best } from './v2/Wall.js';
import { V2Notifications } from './v2/Bell.js';
import { V2Find } from './v2/Find.js';
import { V2Ai } from './v2/Ai.js';
import { V2Automations } from './v2/Automations.js';
import { V2Offers } from './v2/Offers.js';
import { V2ManageProjects } from './v2/ManageProjects.js';
import { V2Card } from './v2/Card.js';
import { V2Messaging } from './v2/Messaging.js';
import { V2Inbox } from './v2/Inbox.js';
import { V2Email } from './v2/Email.js';
import { V2Templates } from './v2/Templates.js';
import { V2Import } from './v2/Import.js';
import { V2SettingsGeneral } from './v2/settings/General.js';
import { V2SettingsNotifications } from './v2/settings/Notifications.js';
import { V2SettingsCompany } from './v2/settings/Company.js';
import { V2SettingsAttendance } from './v2/settings/Attendance.js';
import { V2SettingsAi } from './v2/settings/Ai.js';
import { V2SettingsHealth } from './v2/settings/Health.js';
import { V2SettingsDesks } from './v2/settings/Desks.js';
import { V2SettingsTeam } from './v2/settings/Team.js';
import { V2SettingsPhoneApp } from './v2/settings/PhoneApp.js';
import { V2FeedbackInbox } from './v2/settings/FeedbackInbox.js';
import { V2SettingsBanners } from './v2/settings/Banners.js';
import { V2Feedback } from './v2/Feedback.js';
import { V2Activity } from './v2/Activity.js';
import { V2Dashboard } from './v2/Dashboard.js';
import { V2Live } from './v2/Live.js';
import { V2Lead } from './v2/Lead.js';
import { V2VipGiven } from './v2/VipGiven.js';
import { V2PersonalInfo } from './v2/PersonalInfo.js';
import { V2SettingsSecurity } from './v2/settings/Security.js';
import { TestCopyBanner } from './components/TestCopyBanner.js';
import { OwnerOnly } from './v2/OwnerOnly.js';

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
      <TestCopyBanner />
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
        {/*
          * v2 — the new version, built beside the live one.
          *
          * Its own shell, its own look (the shell sets `data-v2`, which is what
          * turns the orange system on), and its own URLs under /v2, so every
          * screen already built keeps working untouched while the two exist
          * side by side. The master prompt's build order replaces these
          * placeholders one phase at a time.
          */}
        <Route
          element={
            <Protected>
              <V2Shell />
            </Protected>
          }
        >
          <Route path="/v2" element={<V2Home />} />
          <Route path="/v2/incoming" element={<V2Incoming />} />
          <Route path="/v2/leads" element={<V2Leads />} />
          <Route path="/v2/leads/new" element={<V2AddLead />} />
          <Route path="/v2/leads/:id" element={<V2Lead />} />
          {/*
            * Follow-ups is a tab of Tasks, which is where both designs put it
            * and where the menu already points. This address showed the leads
            * list instead — a different screen with different rows — so it
            * sends you to the real one rather than being a second answer.
            */}
          <Route
            path="/v2/follow-ups"
            element={<Navigate to="/v2/tasks?tab=follow-ups" replace />}
          />
          {/* The owner's record of the VIP leads they handed out, from
              `design/screens/OwnerAssign.dc.html` — a screen, not the assign
              dialog it was read as. */}
          <Route path="/v2/vip" element={<OwnerOnly><V2VipGiven /></OwnerOnly>} />
          <Route path="/v2/pipeline" element={<V2Pipeline />} />
          <Route path="/v2/calling" element={<V2Calling />} />
          <Route path="/v2/transfers" element={<V2Transfers />} />
          <Route path="/v2/import" element={<OwnerOnly><V2Import /></OwnerOnly>} />
          <Route path="/v2/calendar" element={<V2Calendar />} />
          <Route path="/v2/tasks" element={<V2Tasks />} />
          <Route path="/v2/projects" element={<V2Projects />} />
          {/* Before `:id`, or "manage" is read as a project's id. */}
          <Route path="/v2/projects/manage" element={<OwnerOnly><V2ManageProjects /></OwnerOnly>} />
          <Route path="/v2/projects/:id" element={<V2Project />} />
          <Route path="/v2/offers" element={<V2Offers />} />
          {/* The agent's own business card, from `digital-card.html`. */}
          <Route path="/v2/card" element={<V2Card />} />
          {/* The messaging funnel, beside Activity in `messaging-report.html`. */}
          <Route path="/v2/messaging" element={<OwnerOnly><V2Messaging /></OwnerOnly>} />
          <Route path="/v2/team" element={<V2Team />} />
          <Route path="/v2/team/:id" element={<V2Person />} />
          <Route path="/v2/wall" element={<V2Wall />} />
          {/* Best of Homes sits beside the Team page in `best-of-homes.html`,
              and is reached from the wall's own ranking card. */}
          <Route path="/v2/best" element={<V2Best />} />
          {/* The bell's panel and the palette both have a whole page behind
              them in the design, and both link to it. */}
          <Route path="/v2/notifications" element={<V2Notifications />} />
          <Route path="/v2/search" element={<V2Find />} />
          <Route path="/v2/attendance" element={<V2Attendance />} />
          <Route path="/v2/activity" element={<OwnerOnly><V2Activity /></OwnerOnly>} />
          <Route path="/v2/dashboard" element={<OwnerOnly><V2Dashboard /></OwnerOnly>} />
          {/* Beside Activity in the design's own segmented control. Owner and
              admin only — the screen refuses, and so does its endpoint. */}
          <Route path="/v2/team-live" element={<OwnerOnly><V2Live /></OwnerOnly>} />
          <Route path="/v2/ai" element={<V2Ai />} />
          {/* Settings, as `design/web/settings.html` lays it out: one shell
              with the section list, a panel per page behind it. The office
              pages are owner and admin only, enforced by every endpoint they
              read as well as by the nav not showing them. */}
          <Route path="/v2/settings" element={<V2SettingsGeneral />} />
          <Route path="/v2/settings/notifications" element={<V2SettingsNotifications />} />
          <Route path="/v2/settings/phone-app" element={<V2SettingsPhoneApp />} />
          <Route path="/v2/settings/team" element={<OwnerOnly><V2SettingsTeam /></OwnerOnly>} />
          <Route path="/v2/settings/attendance" element={<OwnerOnly><V2SettingsAttendance /></OwnerOnly>} />
          <Route path="/v2/settings/automations" element={<OwnerOnly><V2Automations /></OwnerOnly>} />
          <Route path="/v2/settings/company" element={<OwnerOnly><V2SettingsCompany /></OwnerOnly>} />
          <Route path="/v2/settings/ai" element={<OwnerOnly><V2SettingsAi /></OwnerOnly>} />
          <Route path="/v2/settings/desks" element={<OwnerOnly><V2SettingsDesks /></OwnerOnly>} />
          <Route path="/v2/settings/health" element={<OwnerOnly><V2SettingsHealth /></OwnerOnly>} />
          <Route path="/v2/settings/feedback" element={<OwnerOnly><V2FeedbackInbox /></OwnerOnly>} />
          <Route path="/v2/settings/banners" element={<OwnerOnly><V2SettingsBanners /></OwnerOnly>} />
          <Route path="/v2/settings/security" element={<V2SettingsSecurity />} />
          <Route path="/v2/feedback" element={<V2Feedback />} />
          {/* The old address kept working, since it is in the nav of every
              screen already shipped. */}
          <Route path="/v2/automations" element={<OwnerOnly><V2Automations /></OwnerOnly>} />
          <Route path="/v2/profile" element={<V2Person />} />
          {/* Where the settings list's "My profile · Photo, BRN, card" row
              points. It pointed nowhere until now. */}
          <Route path="/v2/me" element={<V2PersonalInfo />} />
          <Route path="/v2/more" element={<V2More />} />
          {/* Messages: the shared inbox, the client emails and the WhatsApp
              templates. They were drawn as a later phase and are built now. */}
          <Route path="/v2/inbox" element={<V2Inbox />} />
          <Route path="/v2/email" element={<V2Email />} />
          <Route path="/v2/templates" element={<V2Templates />} />
        </Route>

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
