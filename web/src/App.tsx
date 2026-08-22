import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DrillPage } from './components/DrillPage';
import { ReviewQueuePage } from './components/ReviewQueuePage';

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
        {/* CourseRail (the actual picker) isn't built yet — land straight on
            the one real lecture we have until it exists. */}
        <Route path="/" element={<Navigate to="/lecture/l01" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
