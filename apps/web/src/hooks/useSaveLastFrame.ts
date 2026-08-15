import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { downloadBlob } from '@/lib/stitchSegments';

/**
 * Keeps the frame a clip ended on — in the library, and on the machine.
 *
 * Both, because "saved" meant two different things to the two sides of this button. In the
 * interface Загрузки is the uploads library; on a computer Загрузки is the folder the
 * browser puts files in. Told the frame was saved there, someone quite reasonably went and
 * looked in the folder and found nothing. Doing one and naming the other is the bug; doing
 * both is the fix.
 *
 * Nothing here re-cuts the frame. The server extracts it once when the clip finishes and
 * keeps it; this asks for the record, takes the bytes it points at and files a copy.
 */

export interface SaveLastFrameSource {
  /** Always present: the clip on screen, whatever produced it. */
  videoUrl: string;
  /** Present only for a clip this studio generated. */
  generationId?: string | undefined;
}

/** Named so a folder of them is readable a week later, rather than eight `last-frame.jpg`. */
function fileNameFor(prompt: string, generationId: string): string {
  const words = prompt
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `last-frame-${words || generationId.slice(-6)}.jpg`;
}

/**
 * The server-cut path: it answers with a stored file rather than bytes, so the copy for the
 * machine is fetched back from the URL it just wrote.
 */
async function saveThenDownload(videoUrl: string) {
  const uploaded = await api.media.saveLastFrame(videoUrl);

  try {
    const response = await fetch(uploaded.url, { credentials: 'include' });
    if (response.ok) downloadBlob(await response.blob(), uploaded.filename || 'last-frame.jpg');
  } catch {
    // The frame is in the library either way, which is the half that persists. A browser
    // that refused the download is not a reason to report the save as failed.
  }

  return uploaded;
}

export function useSaveLastFrame() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (source: SaveLastFrameSource) => {
      // A segment can hold a video that was simply uploaded, with no generation behind it.
      // Those have no cached frame to copy, so the server cuts one from the clip itself.
      if (!source.generationId) {
        return await saveThenDownload(source.videoUrl);
      }

      // Asking the endpoint rather than reading the cache: an older clip may never have had
      // its frame cut, and this is the call that cuts it.
      const generation = await api.generations.lastFrame(source.generationId);
      const url = generation.resultLastFrameUrl;

      // A generation whose frame could not be cut still has its clip, so fall through to
      // cutting from the video rather than telling the user it cannot be done.
      if (!url) return await saveThenDownload(source.videoUrl);

      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return await saveThenDownload(source.videoUrl);

      const blob = await response.blob();
      const file = new File([blob], fileNameFor(generation.prompt, generation.id), {
        type: blob.type || 'image/jpeg',
      });

      const uploaded = await api.media.upload(file);
      downloadBlob(blob, file.name);
      return uploaded;
    },
    onSuccess: () => {
      // The uploads list is keyed per accepted kind, so every variant has to be refreshed
      // or the picker shows a library missing the file that was just put in it.
      void queryClient.invalidateQueries({ queryKey: qk.uploads });
    },
  });
}
