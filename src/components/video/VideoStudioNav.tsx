import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Settings, Sparkles } from 'lucide-react';

const navItems = [
  { label: 'Dashboard', to: '/video-dashboard', icon: LayoutDashboard },
  { label: 'Studio', to: '/video-studio', icon: Sparkles },
  { label: 'Settings', to: '/video-settings', icon: Settings },
];

export default function VideoStudioNav() {
  const location = useLocation();

  return (
    <nav className="flex gap-2 overflow-x-auto pb-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition ${
              active
                ? 'bg-white/[0.1] text-white'
                : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'
            }`}
            to={item.to}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
