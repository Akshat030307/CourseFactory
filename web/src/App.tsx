import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DrillPage } from './components/DrillPage';
import { LandingPage } from './components/LandingPage';
import { ReviewQueuePage } from './components/ReviewQueuePage';
import { UploadPage } from './components/UploadPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/course/:id" element={<AppShell view="course" />} />
        <Route path="/lecture/:id" element={<AppShell view="lecture" />} />
        {/* D3 (Stage 8): due-review drill, spans the whole course rather
            than one lecture — its own route, not nested under AppShell. */}
        <Route path="/drill" element={<DrillPage />} />
        {/* X4 (Stage 9): instructor-facing, no auth to gate it behind —
            its own route, same reasoning as /drill. */}
        <Route path="/review" element={<ReviewQueuePage />} />
        {/* Stage 12: the real "an actual person can use this" upload flow —
            not just the four fixtures ingested from the CLI. */}
        <Route path="/upload" element={<UploadPage />} />
        {/* The real entry point — links into every page above rather than
            skipping straight past them. */}
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
