import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db } from '../firebase';
import { storage } from '../firebaseStorage';
import type {
  CreateVideoGenerationInput,
  VideoGenerationRequest,
  VideoGenerationStatus,
} from '../types/video';

const COLLECTION = 'video_generations';

function cleanUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function createVideoGenerationDocument(userId: string, input: CreateVideoGenerationInput) {
  const documentRef = doc(collection(db, COLLECTION));
  const now = Timestamp.now();
  const request: VideoGenerationRequest = {
    id: documentRef.id,
    userId,
    prompt: input.prompt,
    modelId: input.modelId,
    mode: input.mode,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    stylePreset: input.stylePreset,
    cameraMotion: input.cameraMotion,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  return { documentRef, request };
}

export async function saveVideoGeneration(request: VideoGenerationRequest) {
  await setDoc(doc(db, COLLECTION, request.id), cleanUndefined({ ...request }));
}

export async function updateVideoGeneration(
  generationId: string,
  patch: Partial<VideoGenerationRequest>,
) {
  await updateDoc(doc(db, COLLECTION, generationId), cleanUndefined({
    ...patch,
    updatedAt: Timestamp.now(),
  }));
}

export async function getVideoGeneration(generationId: string) {
  const snapshot = await getDoc(doc(db, COLLECTION, generationId));
  return snapshot.exists() ? (snapshot.data() as VideoGenerationRequest) : null;
}

export function subscribeToUserVideoGenerations(
  userId: string,
  onChange: (items: VideoGenerationRequest[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const generationsQuery = query(collection(db, COLLECTION), where('userId', '==', userId));

  return onSnapshot(
    generationsQuery,
    (snapshot) => {
      const items = snapshot.docs
        .map((entry) => entry.data() as VideoGenerationRequest)
        .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      onChange(items);
    },
    onError,
  );
}

export async function deleteVideoGeneration(generationId: string) {
  await deleteDoc(doc(db, COLLECTION, generationId));
}

export async function uploadReferenceFile(
  userId: string,
  generationId: string,
  file: File,
  slot: 'image' | 'video' | 'audio',
) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const fileRef = ref(storage, `video-generations/${userId}/${generationId}/${slot}-${Date.now()}-${safeName}`);
  await uploadBytes(fileRef, file, { contentType: file.type });
  return getDownloadURL(fileRef);
}

export async function setVideoGenerationStatus(
  generationId: string,
  status: VideoGenerationStatus,
  extra?: Partial<VideoGenerationRequest>,
) {
  await updateVideoGeneration(generationId, { status, ...extra });
}

export async function toggleSavedVideoGeneration(generationId: string, saved: boolean) {
  await updateVideoGeneration(generationId, { saved });
}

export type CreditLogEntry = {
  id: string;
  userId: string;
  type: 'signup' | 'deduction' | 'grant' | 'promo';
  amount: number;
  modelId?: string;
  promoCode?: string;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  grantedBy?: string;
  createdAt: Timestamp;
};

export function subscribeToCredits(
  userId: string,
  onChange: (credits: number) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', userId),
    (snap) => onChange(snap.exists() ? Number(snap.data()?.credits ?? 0) : 0),
    onError,
  );
}

export async function getCreditHistory(
  userId: string,
  pageSize = 20,
  afterDoc?: QueryDocumentSnapshot,
): Promise<{ entries: CreditLogEntry[]; lastDoc: QueryDocumentSnapshot | null }> {
  let q = query(
    collection(db, 'creditLogs'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );
  if (afterDoc) q = query(q, startAfter(afterDoc));
  const snapshot = await getDocs(q);
  const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as CreditLogEntry));
  const lastDoc = snapshot.docs[snapshot.docs.length - 1] ?? null;
  return { entries, lastDoc };
}
