import { Clapperboard } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';

/**
 * Google OAuth needs a real client id and a public callback URL, which a local checkout
 * does not have — without this there is no way to get past this screen on a dev machine.
 * `import.meta.env.DEV` is a compile-time constant, so the whole block below is dropped
 * from a production bundle; the API independently refuses /auth/dev-login unless it was
 * started with AUTH_DEV_LOGIN outside production.
 */
const DEV_SIGN_IN = import.meta.env.DEV;

function DevSignIn() {
  const [email, setEmail] = useState('dev@localhost');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.auth.devLogin(email.trim());
      window.location.assign('/dashboard');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Dev sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border-t border-current/10 pt-5">
      <p className="text-xs uppercase tracking-wider opacity-50">Local development only</p>
      <div className="flex gap-2">
        <Input
          value={email}
          aria-label="Development sign-in email"
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          className="shrink-0 whitespace-nowrap"
          onClick={() => void submit()}
        >
          Sign in
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs opacity-80">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LoginPage() {
  const { t } = useLanguage();
  const { user, isLoading, signIn } = useAuth();
  const [searchParams] = useSearchParams();
  // Reasons the API redirects back with; anything else is treated as a generic failure
  // rather than swallowed, so a user is never returned to a silent login screen.
  const signInError = searchParams.get('error');
  const errorKey =
    signInError === null
      ? null
      : signInError === 'forbidden'
        ? 'login.forbidden'
        : signInError === 'cancelled'
          ? 'login.cancelled'
          : 'login.failed';

  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-current/10">
          <Clapperboard className="h-6 w-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
          <p className="text-sm opacity-70">{t('login.tagline')}</p>
        </div>

        {errorKey ? (
          <p role="alert" className="rounded-xl bg-current/10 px-4 py-3 text-sm">
            {t(errorKey)}
          </p>
        ) : null}

        {isLoading ? (
          <Spinner />
        ) : (
          <Button type="button" onClick={signIn} className="w-full">
            {t('login.continueWithGoogle')}
          </Button>
        )}

        {DEV_SIGN_IN ? <DevSignIn /> : null}
      </Card>
    </div>
  );
}

export default LoginPage;
