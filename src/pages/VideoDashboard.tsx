import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { PlayCircle, Settings, Sparkles } from 'lucide-react';
import VideoStudioNav from '../components/video/VideoStudioNav';
import { auth } from '../firebaseAuth';
import { subscribeToUserVideoGenerations } from '../services/firebaseVideoService';
import type { VideoGenerationRequest } from '../types/video';

function formatDate(value: { toDate: () => Date }) {
  return value.toDate().toLocaleDateString();
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">{label}</p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
    </div>
  );
}

export default function VideoDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [generations, setGenerations] = useState<VideoGenerationRequest[]>([]);
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeToUserVideoGenerations(user.uid, setGenerations, (snapshotError) => setError(snapshotError.message));
  }, [user]);

  const stats = useMemo(() => ({
    total: generations.length,
    completed: generations.filter((generation) => generation.status === 'completed').length,
    processing: generations.filter((generation) => generation.status === 'processing' || generation.status === 'pending').length,
    failed: generations.filter((generation) => generation.status === 'failed').length,
  }), [generations]);

  const recentGenerations = generations.slice(0, 6);

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="w-full px-4 py-5 sm:px-6 lg:px-8 2xl:px-10">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">PingTop AI</p>
            <h1 className="mt-2 text-3xl font-black">Video Dashboard</h1>
          </div>
          <VideoStudioNav />
        </header>

        {!user ? (
          <section className="mb-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-black">Sign in to view your video dashboard</h2>
            <p className="mt-2 text-sm text-slate-300">Your generations are private and attached to your Firebase user.</p>
            <button type="button" onClick={() => void signInAnonymously(auth)} className="mt-4 rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-3 text-sm font-extrabold">
              Continue as guest
            </button>
          </section>
        ) : null}

        {error ? <p className="mb-4 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</p> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total videos" value={stats.total} />
          <MetricCard label="Completed" value={stats.completed} />
          <MetricCard label="Processing" value={stats.processing} />
          <MetricCard label="Failed" value={stats.failed} />
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link to="/video-studio" className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-blue-300/30 bg-blue-500/15 px-4 py-3 text-sm font-extrabold text-blue-100 transition hover:bg-blue-500/25">
            <Sparkles className="h-4 w-4" />
            New video
          </Link>
          <Link to="/video-settings" className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-extrabold text-slate-100 transition hover:bg-white/[0.1]">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </section>

        <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <h2 className="text-lg font-black">Recent generations</h2>
          <div className="mt-4 space-y-3">
            {recentGenerations.length > 0 ? recentGenerations.map((generation) => (
              <article key={generation.id} className="grid gap-3 rounded-lg border border-white/10 bg-[#0b1020] p-3 sm:grid-cols-[140px_1fr_auto] sm:items-center">
                <div className="overflow-hidden rounded-lg bg-black">
                  {generation.resultVideoUrl ? (
                    <video src={generation.resultVideoUrl} className="aspect-video w-full object-cover" muted playsInline />
                  ) : (
                    <div className="flex aspect-video items-center justify-center text-xs font-bold text-slate-500">{generation.status}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm leading-6 text-slate-200">{generation.prompt}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                    <span className="rounded-full bg-white/[0.06] px-2 py-1">{generation.status}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-1">{generation.modelId}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-1">{formatDate(generation.createdAt)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => navigate(`/video-studio?generation=${generation.id}`)} className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-500/15 px-3 py-2 text-sm font-bold text-blue-100">
                  <PlayCircle className="h-4 w-4" />
                  Open
                </button>
              </article>
            )) : (
              <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
                No videos yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
