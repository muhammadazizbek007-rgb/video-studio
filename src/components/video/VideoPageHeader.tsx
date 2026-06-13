import type { ReactNode } from 'react';
import VideoStudioNav from './VideoStudioNav';

export default function VideoPageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">PingTop AI</p>
        <h1 className="mt-2 text-3xl font-black tracking-normal text-white sm:text-4xl">{title}</h1>
        {children}
      </div>
      <VideoStudioNav />
    </header>
  );
}
