import type { Timestamp } from 'firebase/firestore';

export type VideoElementCategory = 'general' | 'character' | 'location' | 'prop';

export interface VideoElement {
  id: string;
  userId: string;
  name: string;
  handle: string; // "@Luna"
  category: VideoElementCategory;
  imageUrl: string;
  storagePath: string;
  description?: string; // Used for prompt augmentation: "@Luna" → description
  pinned: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
