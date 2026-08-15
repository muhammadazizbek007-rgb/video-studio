import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * Keeps the frame a clip ended on, as a file in the library.
 *
 * The last-frame tab already offers that frame to the slot that follows, but only there and
 * only for that one slot. Saving it as an upload takes it out of that corner: it becomes an
 * ordinary picture, usable in any slot, in an element, or downloaded and sent to somebody.
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

export function useSaveLastFrame() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (source: SaveLastFrameSource) => {
      // A segment can hold a video that was simply uploaded, with no generation behind it.
      // Those have no cached frame to copy, so the server cuts one from the clip itself.
      if (!source.generationId) {
        return await api.media.saveLastFrame(source.videoUrl);
      }

      // Asking the endpoint rather than reading the cache: an older clip may never have had
      // its frame cut, and this is the call that cuts it.
      const generation = await api.generations.lastFrame(source.generationId);
      const url = generation.resultLastFrameUrl;

      // A generation whose frame could not be cut still has its clip, so fall through to
      // cutting from the video rather than telling the user it cannot be done.
      if (!url) return await api.media.saveLastFrame(source.videoUrl);

      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) return await api.media.saveLastFrame(source.videoUrl);

      const blob = await response.blob();
      const file = new File([blob], fileNameFor(generation.prompt, generation.id), {
        type: blob.type || 'image/jpeg',
      });

      return await api.media.upload(file);
    },
    onSuccess: () => {
      // The uploads list is keyed per accepted kind, so every variant has to be refreshed
      // or the picker shows a library missing the file that was just put in it.
      void queryClient.invalidateQueries({ queryKey: qk.uploads });
    },
  });
}
