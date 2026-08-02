import { Moon, Sun } from 'lucide-react';
import type { IconButtonProps, IconButtonSize } from './IconButton';
import { IconButton } from './IconButton';
import { useTheme } from './useTheme';

export interface ThemeToggleProps extends Omit<IconButtonProps, 'icon' | 'label' | 'onClick'> {
  size?: IconButtonSize;
  /**
   * Accessible name, describing the theme this switches TO. The design system stays
   * i18n-agnostic, so the translated string is the caller's to supply.
   */
  label?: string;
}

export function ThemeToggle({ size = 'md', className, label, ...rest }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <IconButton
      label={label ?? (isDark ? 'Light theme' : 'Dark theme')}
      icon={isDark ? <Sun /> : <Moon />}
      size={size}
      round
      className={className}
      onClick={toggle}
      {...rest}
    />
  );
}
