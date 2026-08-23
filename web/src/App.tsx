import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DrillPage } from './components/DrillPage';
import { LandingPage } from './components/LandingPage';
import { LoginPage } from './components/LoginPage';
import { RequireAuth } from './components/RequireAuth';
import { RequireRole } from './components/RequireRole';
import { ReviewQueuePage } from './components/ReviewQueuePage';
import { SignupPage } from './components/SignupPage';
import { UploadPage } from './components/UploadPage';
import { WaitlistPage } from './components/WaitlistPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/course/:id"
          element={
            <RequireAuth>
              <AppShell view="course" />
            </RequireAuth>
          }
        />
        <Route
          path="/lecture/:id"
          element={
            <RequireAuth>
              <AppShell view="lecture" />
            </RequireAuth>
          }
        />
        {/* D3 (Stage 8): due-review drill, spans the whole course rather
            than one lecture — its own route, not nested under AppShell. */}
        <Route
          path="/drill"
          element={
            <RequireAuth>
              <DrillPage />
            </RequireAuth>
          }
        />
        {/* X4 (Stage 9): instructor-facing. Stage 15 added real student
            accounts alongside the one instructor account, so this is now
            RequireRole (not just RequireAuth) — a student session is
            authenticated but not authorized here, same as the gateway's
            own require_instructor check. */}
        <Route
          path="/review"
          element={
            <RequireRole role="instructor">
              <ReviewQueuePage />
            </RequireRole>
          }
        />
        {/* Stage 12: the real "an actual person can use this" upload flow —
            not just the four fixtures ingested from the CLI. Instructor-only
            (Stage 15) — course content management, not a student surface. */}
        <Route
          path="/upload"
          element={
            <RequireRole role="instructor">
              <UploadPage />
            </RequireRole>
          }
        />
        {/* Stage 14: still no self-service registration (see CLAUDE.md) —
            /signup only ever writes to the waitlist table. /waitlist is
            the admin-only view of it (Stage 15: instructor-only, since it's
            also where real student accounts get created). */}
        <Route
          path="/waitlist"
          element={
            <RequireRole role="instructor">
              <WaitlistPage />
            </RequireRole>
          }
        />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* The real entry point — public, unlike everything above. Links
            into the gated app rather than skipping straight past it. */}
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
