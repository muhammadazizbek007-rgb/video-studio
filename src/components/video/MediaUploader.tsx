import { FileAudio, FileImage, FileVideo, Upload } from 'lucide-react';
import type { ReactNode } from 'react';

interface MediaUploaderProps {
  imageFile?: File | null;
  videoFile?: File | null;
  audioFile?: File | null;
  onImageChange: (file: File | null) => void;
  onVideoChange: (file: File | null) => void;
  onAudioChange: (file: File | null) => void;
}

function UploadField({
  label,
  accept,
  file,
  icon,
  onChange,
}: {
  label: string;
  accept: string;
  file?: File | null;
  icon: ReactNode;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-24 cursor-pointer flex-col justify-between rounded-lg border border-dashed border-white/14 bg-white/[0.035] p-3 transition hover:border-blue-400/70 hover:bg-blue-500/10">
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
        {icon}
        {label}
      </span>
      <span className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <Upload className="h-3.5 w-3.5" />
        {file ? file.name : 'Upload optional reference'}
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

export default function MediaUploader(props: MediaUploaderProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <UploadField
        label="Reference image"
        accept="image/*"
        file={props.imageFile}
        icon={<FileImage className="h-4 w-4 text-blue-300" />}
        onChange={props.onImageChange}
      />
      <UploadField
        label="Reference video"
        accept="video/*"
        file={props.videoFile}
        icon={<FileVideo className="h-4 w-4 text-violet-300" />}
        onChange={props.onVideoChange}
      />
      <UploadField
        label="Reference audio"
        accept="audio/*"
        file={props.audioFile}
        icon={<FileAudio className="h-4 w-4 text-cyan-300" />}
        onChange={props.onAudioChange}
      />
    </div>
  );
}
