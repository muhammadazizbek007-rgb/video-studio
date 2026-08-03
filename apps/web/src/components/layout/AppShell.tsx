import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { NavBar } from './NavBar';

interface AppShellProps {
  children?: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <NavBar />
      {/* Bottom padding clears the mobile tab bar; md drops it because the bar is gone. */}
      <main className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 md:pb-10">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}

export default AppShell;
