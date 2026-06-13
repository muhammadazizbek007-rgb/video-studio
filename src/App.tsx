import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import VideoAccessGate from './components/video/VideoAccessGate';
import { LanguageProvider } from './context/LanguageContext';

const VideoDashboard = lazy(() => import('./pages/VideoDashboard'));
const VideoStudio = lazy(() => import('./pages/VideoStudio'));
const VideoSettings = lazy(() => import('./pages/VideoSettings'));

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/video-dashboard" replace />} />
            <Route path="/video-dashboard" element={<VideoAccessGate><VideoDashboard /></VideoAccessGate>} />
            <Route path="/video-studio" element={<VideoAccessGate><VideoStudio /></VideoAccessGate>} />
            <Route path="/video-settings" element={<VideoAccessGate><VideoSettings /></VideoAccessGate>} />
            <Route path="*" element={<Navigate to="/video-dashboard" replace />} />
          </Routes>
        </Suspense>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
