import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { queryClient } from '@/lib/queryClient';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const StudioPage = lazy(() => import('@/pages/StudioPage'));
const CinemaStudioPage = lazy(() => import('@/pages/CinemaStudioPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/login" element={<LoginPage />} />
                {/* A layout route so the nav mounts once and survives navigation between
                    the three pages, rather than remounting with each of them. */}
                <Route
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/studio" element={<StudioPage />} />
                  <Route path="/cinema" element={<CinemaStudioPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </LanguageProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
