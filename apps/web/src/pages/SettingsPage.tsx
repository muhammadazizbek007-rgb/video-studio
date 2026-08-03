import type { ImageModelSpec, VeoModelSpec } from '@video-studio/shared';
import { LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Select, Skeleton, ThemeToggle } from '@/components/ui';
import { useTheme } from '@/components/ui/useTheme';
import { ElementLibrary } from '@/components/video/ElementLibrary';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';

const LANGUAGES = ['ru', 'uz', 'en'] as const;
type LanguageCode = (typeof LANGUAGES)[number];

function toLanguage(value: string): LanguageCode | undefined {
  return LANGUAGES.find((code) => code === value);
}

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  return typeof configured === 'string' ? configured : '';
}

type HealthState = 'checking' | 'ok' | 'down';

export function SettingsPage() {
  const { language, setLanguage, t } = useLanguage();
  const { theme } = useTheme();
  const { user, signOut } = useAuth();

  const [health, setHealth] = useState<HealthState>('checking');
  const [models, setModels] = useState<{ video: VeoModelSpec[]; image: ImageModelSpec[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiBaseUrl()}/api/health/ready`, { credentials: 'include' })
      .then((response) => {
        if (!cancelled) setHealth(response.ok ? 'ok' : 'down');
      })
      .catch(() => {
        if (!cancelled) setHealth('down');
      });

    api.models
      .list()
      .then((result) => {
        if (!cancelled) setModels(result);
      })
      .catch(() => {
        if (!cancelled) setModels(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>

      <Card className="flex flex-wrap items-center gap-4 p-4">
        {user?.picture ? (
          <img src={user.picture} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-current/10 text-lg font-semibold">
            {user?.name.slice(0, 1).toUpperCase() ?? '?'}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.name ?? '—'}</p>
          <p className="truncate text-sm opacity-70">{user?.email ?? '—'}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="ml-auto"
          onClick={() => void signOut()}
        >
          <LogOut className="h-4 w-4" />
          {t('nav.signOut')}
        </Button>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.appearance')}</h2>
          <p className="text-sm opacity-70">{t('settings.appearanceHint')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={language}
            aria-label={t('nav.language')}
            onChange={(event) => {
              const next = toLanguage(event.target.value);
              if (next) setLanguage(next);
            }}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t(`language.${code}`)}
              </option>
            ))}
          </Select>
          <ThemeToggle label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')} />
        </div>
      </Card>

      <Card className="p-4">
        <ElementLibrary />
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t('settings.diagnostics')}</h2>
          <Badge tone={health === 'ok' ? 'success' : health === 'down' ? 'danger' : 'neutral'}>
            {t(`settings.health.${health}`)}
          </Badge>
        </div>

        {models === null ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
                {t('settings.videoModels')}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {models.video.map((spec) => (
                  <li key={spec.id}>
                    <Badge tone="neutral">
                      {spec.name} · {spec.vertexModel}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-60">
                {t('settings.imageModels')}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {models.image.map((spec) => (
                  <li key={spec.id}>
                    <Badge tone="neutral">
                      {spec.name} · {spec.vertexModel}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default SettingsPage;
