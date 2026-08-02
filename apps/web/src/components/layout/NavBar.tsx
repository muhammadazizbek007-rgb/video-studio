import { Clapperboard, LayoutDashboard, LogOut, Settings as SettingsIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { IconButton, Select, ThemeToggle } from '@/components/ui';
import { useTheme } from '@/components/ui/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';

const LANGUAGES = ['ru', 'uz', 'en'] as const;
type LanguageCode = (typeof LANGUAGES)[number];

function toLanguage(value: string): LanguageCode | undefined {
  return LANGUAGES.find((code) => code === value);
}

interface Destination {
  to: string;
  labelKey: TranslationKey;
  Icon: ComponentType<{ className?: string }>;
}

const DESTINATIONS: readonly Destination[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', Icon: LayoutDashboard },
  { to: '/studio', labelKey: 'nav.studio', Icon: Clapperboard },
  { to: '/settings', labelKey: 'nav.settings', Icon: SettingsIcon },
];

export function NavBar() {
  const { language, setLanguage, t } = useLanguage();
  const { theme } = useTheme();
  const { user, signOut } = useAuth();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-current/10 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3">
          <NavLink to="/dashboard" className="flex items-center gap-2 font-semibold">
            <Clapperboard className="h-5 w-5" />
            <span>{t('app.name')}</span>
          </NavLink>

          <nav aria-label={t('nav.primary')} className="ml-6 hidden items-center gap-1 md:flex">
            {DESTINATIONS.map(({ to, labelKey, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                    isActive ? 'bg-current/10 font-semibold' : 'opacity-70 hover:opacity-100'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
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

            <ThemeToggle
              data-testid="theme-toggle"
              label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            />

            {user ? (
              <div className="flex items-center gap-2">
                {user.picture ? (
                  <img src={user.picture} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-current/10 text-xs font-semibold">
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {/* The email, not the display name: the allow-list is keyed on it, so it is
                    what tells a user which account they are actually signed in as. */}
                <span
                  data-testid="user-email"
                  title={user.email}
                  className="hidden max-w-44 truncate text-sm lg:block"
                >
                  {user.email}
                </span>
                <IconButton
                  type="button"
                  label={t('nav.signOut')}
                  icon={<LogOut />}
                  data-testid="sign-out"
                  onClick={() => void signOut()}
                />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-current/10 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch">
          {DESTINATIONS.map(({ to, labelKey, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2 text-xs ${
                  isActive ? 'font-semibold' : 'opacity-60'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {t(labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}

export default NavBar;
