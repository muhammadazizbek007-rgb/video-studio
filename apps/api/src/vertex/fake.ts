import { getStorage } from '../storage/index.js';
import type { VeoPollResult } from './veo.js';

/**
 * Offline stand-in for Vertex AI, used when FAKE_VERTEX is on (E2E, local development).
 * Nothing here touches the network or needs credentials, and the media it produces is
 * written through the real storage driver so the browser can actually play it back.
 */

/**
 * A 973-byte MP4: two frames of 16x16 black H.264 baseline at 15fps (~0.13s), produced
 * with AVFoundation. Real container, real codec — players and <video> accept it.
 */
const TINY_MP4_BASE64 =
  'AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQxbXA0MgAAAAFtZGF0AAAAAAAAAQYAAAA7BgUyR1ZK3FxMQz+U78UR' +
  'PNFDqAEAAAMAAQMAAAMAAQIAAA+gCwAAAwAAAwAAAwB4DAOJJAEN/////4AAAABLJbggAe///4eigD/D//Dw' +
  'UF++++++++++/j//w9F+uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuvAAAA' +
  'AGgYFFUdWStxcTEM/lO/FETzRQ6gDAAADAAGAAAAARiW4EAAk///4eig+44UAN9999999999YoAa666666666' +
  '66666666666666666666666666666666666666666666666668AAAAKrbW9vdgAAAGxtdmhkAAAAAOaUqSDm' +
  'lKkgAAACWAAAAFAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjd0cmFrAAAAXHRraGQAAAAB5pSpIOaUqSAAAAABAAAA' +
  'AAAAAFAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQ' +
  'AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAABQAAAAAAABAAAAAAGvbWRpYQAAACBtZGhkAAAAAOaUqSDm' +
  'lKkgAAACWAAAAFBVxAAAAAAAMWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABDb3JlIE1lZGlhIFZpZGVv' +
  'AAAAAVZtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAA' +
  'AAEAAAEWc3RibAAAAJxzdHNkAAAAAAAAAAEAAACMYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAQABAA' +
  'SAAAAEgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAACJhdmNDAUIAC//h' +
  'AAsnQgALq4YbwLMFKAEABCjOPIAAAAAKZmllbAEAAAAACmNocm0AAAAAABhzdHRzAAAAAAAAAAEAAAACAAAA' +
  'KAAAAA5zZHRwAAAAACAgAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAAC' +
  'AAAAjgAAAGgAAAAUc3RjbwAAAAAAAAABAAAALA==';

/** A 79-byte 16x16 opaque dark-slate PNG. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mNQUNIgCTGMahjVMHw1AABUjmoB' +
  'IGy3dAAAAABJRU5ErkJggg==';

export interface FakeVeoOperation {
  operationName: string;
  vertexModel: string;
  userId: string;
  generationId: string;
  prompt: string;
  aspectRatio: string;
  duration: number;
  checkCount: number;
}

const operations = new Map<string, FakeVeoOperation>();

export interface FakeVeoStartInput {
  generationId: string;
  userId: string;
  prompt: string;
  vertexModel: string;
  aspectRatio: string;
  duration: number;
}

/**
 * The name is derived from the generation rather than random so a restarted process can
 * still poll an operation it did not start.
 */
function fakeOperationName(vertexModel: string, generationId: string): string {
  return `fake/publishers/google/models/${vertexModel}/operations/${generationId}`;
}

export function startFakeVeoOperation(input: FakeVeoStartInput): {
  operationName: string;
  vertexModel: string;
} {
  const operationName = fakeOperationName(input.vertexModel, input.generationId);
  operations.set(operationName, {
    operationName,
    vertexModel: input.vertexModel,
    userId: input.userId,
    generationId: input.generationId,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    checkCount: 0,
  });
  return { operationName, vertexModel: input.vertexModel };
}

export function readFakeVeoOperation(operationName: string): FakeVeoOperation | undefined {
  return operations.get(operationName);
}

export function resetFakeVertex(): void {
  operations.clear();
}

export function fakeVideoKey(userId: string, generationId: string): string {
  return `generations/${userId}/${generationId}/video.mp4`;
}

export async function checkFakeVeoOperation(args: {
  operationName: string;
  userId: string;
  generationId: string;
}): Promise<VeoPollResult> {
  const operation = operations.get(args.operationName);
  if (operation) operation.checkCount += 1;

  const stored = await getStorage().save({
    key: fakeVideoKey(args.userId, args.generationId),
    data: Buffer.from(TINY_MP4_BASE64, 'base64'),
    contentType: 'video/mp4',
  });

  return { status: 'completed', videoUrl: stored.url, storagePath: stored.path };
}

export async function generateFakeImage(args: {
  userId: string;
  imageId: string;
}): Promise<{ imageUrl: string; storagePath: string }> {
  const stored = await getStorage().save({
    key: `images/${args.userId}/${args.imageId}.png`,
    data: Buffer.from(TINY_PNG_BASE64, 'base64'),
    contentType: 'image/png',
  });

  return { imageUrl: stored.url, storagePath: stored.path };
}
