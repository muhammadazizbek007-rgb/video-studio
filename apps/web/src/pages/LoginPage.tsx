import { Clapperboard } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Spinner } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';

export function LoginPage() {
  const { t } = useLanguage();
  const { user, isLoading, signIn } = useAuth();
  const [searchParams] = useSearchParams();
  const forbidden = searchParams.get('error') === 'forbidden';

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

        {forbidden ? (
          <p role="alert" className="rounded-xl bg-current/10 px-4 py-3 text-sm">
            {t('login.forbidden')}
          </p>
        ) : null}

        {isLoading ? (
          <Spinner />
        ) : (
          <Button type="button" onClick={signIn} className="w-full">
            {t('login.continueWithGoogle')}
          </Button>
        )}
      </Card>
    </div>
  );
}

export default LoginPage;
