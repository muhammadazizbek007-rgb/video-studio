const configuredEmails = import.meta.env.VITE_VIDEO_STUDIO_ALLOWED_EMAILS;

export const videoStudioAllowedEmails = String(configuredEmails || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export function canAccessVideoStudio(email?: string | null) {
  if (videoStudioAllowedEmails.length === 0) return true;
  return Boolean(email && videoStudioAllowedEmails.includes(email.toLowerCase()));
}
