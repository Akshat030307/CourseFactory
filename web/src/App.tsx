import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DrillPage } from './components/DrillPage';
import { LandingPage } from './components/LandingPage';
import { LoginPage } from './components/LoginPage';
import { RequireAuth } from './components/RequireAuth';
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
        {/* X4 (Stage 9): instructor-facing — same login gate as everything
            else now (Stage 13); there's no separate instructor account. */}
        <Route
          path="/review"
          element={
            <RequireAuth>
              <ReviewQueuePage />
            </RequireAuth>
          }
        />
        {/* Stage 12: the real "an actual person can use this" upload flow —
            not just the four fixtures ingested from the CLI. */}
        <Route
          path="/upload"
          element={
            <RequireAuth>
              <UploadPage />
            </RequireAuth>
          }
        />
        {/* Stage 14: still no self-service registration (see CLAUDE.md) —
            /signup only ever writes to the waitlist table. /waitlist is
            the admin-only view of it, gated like everything else above. */}
        <Route
          path="/waitlist"
          element={
            <RequireAuth>
              <WaitlistPage />
            </RequireAuth>
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
