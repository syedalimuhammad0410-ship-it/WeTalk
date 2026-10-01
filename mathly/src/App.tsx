import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './lib/store.tsx';
import { Layout } from './components/Layout.tsx';
import { PageSkeleton, Spinner } from './components/ui.tsx';
import { LogoMark } from './components/Logo.tsx';

const Welcome = lazy(() => import('./pages/Welcome.tsx'));
const Auth = lazy(() => import('./pages/Auth.tsx'));
const Profiles = lazy(() => import('./pages/Profiles.tsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.tsx'));
const Placement = lazy(() => import('./pages/Placement.tsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.tsx'));
const Learn = lazy(() => import('./pages/Learn.tsx'));
const CoursePage = lazy(() => import('./pages/Course.tsx'));
const Lesson = lazy(() => import('./pages/Lesson.tsx'));
const Practice = lazy(() => import('./pages/Practice.tsx'));
const PracticeSession = lazy(() => import('./pages/PracticeSession.tsx'));
const Daily = lazy(() => import('./pages/Daily.tsx'));
const SkillTree = lazy(() => import('./pages/SkillTree.tsx'));
const Tutor = lazy(() => import('./pages/Tutor.tsx'));
const Homework = lazy(() => import('./pages/Homework.tsx'));
const LearnAnything = lazy(() => import('./pages/LearnAnything.tsx'));
const TestPrep = lazy(() => import('./pages/TestPrep.tsx'));
const TestPlan = lazy(() => import('./pages/TestPlan.tsx'));
const MockTest = lazy(() => import('./pages/MockTest.tsx'));
const Presentation = lazy(() => import('./pages/Presentation.tsx'));
const Planner = lazy(() => import('./pages/Planner.tsx'));
const Organizer = lazy(() => import('./pages/Organizer.tsx'));
const Progress = lazy(() => import('./pages/Progress.tsx'));
const Resources = lazy(() => import('./pages/Resources.tsx'));
const Family = lazy(() => import('./pages/Family.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Notifications = lazy(() => import('./pages/Notifications.tsx'));
const Admin = lazy(() => import('./pages/Admin.tsx'));
const Setup = lazy(() => import('./pages/Setup.tsx'));

function Boot() {
  return <div className="grid min-h-dvh place-items-center"><div className="flex flex-col items-center gap-4"><div className="animate-pulse"><LogoMark size={64} /></div><Spinner className="p-0" /></div></div>;
}

/** Route guard: account/guest → profile → onboarding. */
function Gate({ children, needProfile = true, needOnboarded = true }: { children: ReactNode; needProfile?: boolean; needOnboarded?: boolean }) {
  const { ready, user, profile } = useApp();
  const loc = useLocation();
  if (!ready) return <Boot />;
  if (!user) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (needProfile && !profile) return <Navigate to="/profiles" replace />;
  if (needProfile && needOnboarded && profile && !profile.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export function App() {
  const { ready } = useApp();
  if (!ready) return <Boot />;
  return (
    <Suspense fallback={<Boot />}>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/profiles" element={<Gate needProfile={false}><Profiles /></Gate>} />
        <Route path="/onboarding" element={<Gate needOnboarded={false}><Onboarding /></Gate>} />
        <Route path="/placement" element={<Gate><Placement /></Gate>} />
        <Route element={<Gate><Layout /></Gate>}>
          <Route index element={<S><Dashboard /></S>} />
          <Route path="learn" element={<S><Learn /></S>} />
          <Route path="learn/:courseId" element={<S><CoursePage /></S>} />
          <Route path="learn/:courseId/lesson/:lessonId" element={<S><Lesson /></S>} />
          <Route path="lesson/:lessonId" element={<S><Lesson /></S>} />
          <Route path="practice" element={<S><Practice /></S>} />
          <Route path="practice/session" element={<S><PracticeSession /></S>} />
          <Route path="daily" element={<S><Daily /></S>} />
          <Route path="skills" element={<S><SkillTree /></S>} />
          <Route path="tutor" element={<S><Tutor /></S>} />
          <Route path="homework" element={<S><Homework /></S>} />
          <Route path="homework/:id" element={<S><Homework /></S>} />
          <Route path="learn-anything" element={<S><LearnAnything /></S>} />
          <Route path="test-prep" element={<S><TestPrep /></S>} />
          <Route path="test-prep/:id" element={<S><TestPlan /></S>} />
          <Route path="mock-test" element={<S><MockTest /></S>} />
          <Route path="presentation" element={<S><Presentation /></S>} />
          <Route path="planner" element={<S><Planner /></S>} />
          <Route path="organizer" element={<S><Organizer /></S>} />
          <Route path="progress" element={<S><Progress /></S>} />
          <Route path="resources" element={<S><Resources /></S>} />
          <Route path="family" element={<S><Family /></S>} />
          <Route path="settings" element={<S><Settings /></S>} />
          <Route path="notifications" element={<S><Notifications /></S>} />
          <Route path="admin" element={<S><Admin /></S>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function S({ children }: { children: ReactNode }) { return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>; }
function NotFound() {
  return <div className="py-24 text-center"><p className="text-6xl">🧭</p><h1 className="mt-4 text-2xl font-extrabold">Page not found</h1><p className="mt-2 text-muted">That page doesn’t exist. Let’s get you back on track.</p><a href="/" className="mt-6 inline-block font-semibold text-accent">Go home</a></div>;
}
