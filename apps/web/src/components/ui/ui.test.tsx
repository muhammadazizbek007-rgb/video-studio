import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Modal } from './Modal';
import { ThemeToggle } from './ThemeToggle';
import { Toggle } from './Toggle';
import { resetThemeCache } from './useTheme';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('renders each variant with its own treatment', () => {
    render(
      <>
        <Button variant="primary">Создать</Button>
        <Button variant="ghost">Отмена</Button>
        <Button variant="danger">Удалить</Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Создать' }).className).toContain('bg-accent');
    expect(screen.getByRole('button', { name: 'Отмена' }).className).toContain(
      'shadow-neu-raised-sm',
    );
    expect(screen.getByRole('button', { name: 'Удалить' }).className).toContain('text-danger');
  });

  it('blocks clicks while loading and reports aria-busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Генерация
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Генерация/ });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Открыть</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Настройки">
        <p>Содержимое</p>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const trigger = screen.getByRole('button', { name: 'Открыть' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe('Toggle', () => {
  it('flips on Space and reports aria-checked', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Toggle label="Звук" onCheckedChange={onCheckedChange} />);

    const toggle = screen.getByRole('switch', { name: 'Звук' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    toggle.focus();
    await user.keyboard(' ');

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    resetThemeCache();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark', 'light');
  });

  it('toggles the class on <html> and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const root = document.documentElement;
    const startedDark = root.classList.contains('dark');

    await user.click(screen.getByRole('button'));

    expect(root.classList.contains('dark')).toBe(!startedDark);
    expect(root.classList.contains('light')).toBe(startedDark);
    expect(window.localStorage.getItem('vs-theme')).toBe(startedDark ? 'light' : 'dark');
  });
});
