import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { LockKeyhole } from 'lucide-react';
import { auth } from '../../firebaseAuth';
import { canAccessVideoStudio, videoStudioAllowedEmails } from '../../config/videoStudioAccess';
import VideoLanguageBridge from './VideoLanguageBridge';

export default function VideoAccessGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setLoading(false);
  }), []);

  async function signIn() {
    setError('');
    try {
      await signInAnonymously(auth);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Failed to sign in.');
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050816] text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#050816] px-4 py-10 text-white">
        <section className="mx-auto max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/15 text-blue-100">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-2xl font-black">PingTop AI Video Studio</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Sign in to access your private creative workspace.</p>
          <button type="button" onClick={() => void signIn()} className="mt-5 min-h-11 w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2 text-sm font-extrabold">
            Continue as guest
          </button>
          {error ? <p className="mt-3 text-sm font-bold text-rose-200">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (!canAccessVideoStudio(user.email)) {
    return (
      <main className="min-h-screen bg-[#050816] px-4 py-10 text-white">
        <section className="mx-auto max-w-md rounded-lg border border-rose-400/20 bg-rose-500/10 p-6 text-center">
          <h1 className="text-2xl font-black">Access denied</h1>
          <p className="mt-2 text-sm leading-6 text-rose-100">
            This Firebase user is not allowed to access PingTop AI Video Studio.
          </p>
          <p className="mt-3 break-all text-xs text-rose-100/80">
            Signed in as: {user.email || user.uid}
          </p>
          {videoStudioAllowedEmails.length > 0 ? (
            <p className="mt-3 text-xs text-rose-100/70">Allowed emails are configured in `VITE_VIDEO_STUDIO_ALLOWED_EMAILS`.</p>
          ) : null}
        </section>
      </main>
    );
  }

  return <VideoLanguageBridge>{children}</VideoLanguageBridge>;
}
