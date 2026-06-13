import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db } from '../firebase';
import { storage } from '../firebaseStorage';
import type { VideoElement, VideoElementCategory } from '../types/videoElement';

const COLLECTION = 'video_elements';

export async function uploadElementImage(userId: string, elementId: string, file: File): Promise<{ imageUrl: string; storagePath: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `video-elements/${userId}/${elementId}/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, storagePath);
  await uploadBytes(fileRef, file, { contentType: file.type });
  const imageUrl = await getDownloadURL(fileRef);
  return { imageUrl, storagePath };
}

export async function saveVideoElement(element: VideoElement): Promise<void> {
  await setDoc(doc(db, COLLECTION, element.id), element);
}

export async function deleteVideoElement(element: VideoElement): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, element.id));
  if (element.storagePath) {
    try {
      await deleteObject(ref(storage, element.storagePath));
    } catch { /* ignore if already deleted */ }
  }
}

export async function togglePinVideoElement(elementId: string, pinned: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTION, elementId), { pinned, updatedAt: Timestamp.now() });
}

export function subscribeToUserVideoElements(
  userId: string,
  onChange: (items: VideoElement[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, COLLECTION), where('userId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => d.data() as VideoElement)
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      onChange(items);
    },
    onError,
  );
}

export function buildHandle(name: string): string {
  const clean = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_а-яёА-ЯЁ]/g, '');
  return `@${clean}`;
}

export function extractMentions(prompt: string): string[] {
  const matches = prompt.match(/@[\wа-яёА-ЯЁ]+/g) ?? [];
  return [...new Set(matches)];
}

export function findElementsByMentions(elements: VideoElement[], mentions: string[]): VideoElement[] {
  const lower = mentions.map((m) => m.toLowerCase());
  return elements.filter((el) => lower.includes(el.handle.toLowerCase()));
}

export const CATEGORY_LABELS: Record<VideoElementCategory, string> = {
  general: 'Общие',
  character: 'Персонажи',
  location: 'Локации',
  prop: 'Реквизит',
};
