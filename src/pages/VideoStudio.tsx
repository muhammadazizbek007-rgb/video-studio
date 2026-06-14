import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { Timestamp, doc, collection } from 'firebase/firestore';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileAudio,
  FileVideo,
  Folder,
  Heart,
  Images,
  ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Pin,
  Volume2,
  Volume1,
  VolumeX,
  PinOff,
  PlayCircle,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import GenerationStatus from '../components/video/GenerationStatus';
import VideoResult from '../components/video/VideoResult';
import PromptEditor from '../components/video/PromptEditor';
import ReferenceSummary from '../components/video/ReferenceSummary';
import { videoModels } from '../models/videoModels';
import { auth } from '../firebaseAuth';
import { db } from '../firebase';
import {
  getVideoGeneration,
  subscribeToCredits,
  subscribeToUserVideoGenerations,
  toggleSavedVideoGeneration,
} from '../services/firebaseVideoService';
import { generateVideo } from '../services/videoGenerationService';
import { callWorker } from '../lib/callWorker';
import {
  subscribeToUserVideoElements,
  saveVideoElement,
  deleteVideoElement,
  togglePinVideoElement,
  uploadElementImage,
  buildHandle,
  extractMentions,
  findElementsByMentions,
  CATEGORY_LABELS,
} from '../services/videoElementsService';
import { buildGenerationContext } from '../services/referenceResolver';
import type { VideoElement, VideoElementCategory } from '../types/videoElement';
import type {
  CameraMotion,
  VideoAspectRatio,
  VideoDuration,
  VideoGenerationMode,
  VideoGenerationRequest,
  VideoStylePreset,
} from '../types/video';

const MODEL_CREDIT_COST: Record<string, number> = {
  'wavespeed-wan': 10, 'wavespeed-wan-i2v': 10,
  'seedance-2': 25, 'seedance-2-fast': 15,
  'replicate-wan-t2v': 10, 'replicate-wan-i2v': 10,
  'replicate-kling': 20, 'replicate-luma': 15,
  'huggingface-cogvideox': 10, 'huggingface-opensora': 10,
  'cogvideox-free': 5, 'ltx-fast': 5, 'svd': 5,
  'leonardo-motion': 15, 'json2video': 10,
};

const durationOptions: VideoDuration[] = [5, 10, 15];
const aspectOptions: VideoAspectRatio[] = ['9:16', '16:9', '1:1'];

const stylePresets: { value: VideoStylePreset; label: string; emoji: string }[] = [
  { value: 'Cinematic', label: 'Кино', emoji: '🎬' },
  { value: 'UGC', label: 'UGC', emoji: '📱' },
  { value: 'App Promo', label: 'Промо', emoji: '✨' },
  { value: 'AI Social Platform Ad', label: 'Реклама', emoji: '🚀' },
  { value: 'School Viral Reel', label: 'Вирусный', emoji: '🔥' },
  { value: 'Product Demo', label: 'Демо', emoji: '🎯' },
  { value: 'Character Story', label: 'История', emoji: '🎭' },
];

const cameraMotions: { value: CameraMotion; label: string }[] = [
  { value: 'Static', label: 'Статика' },
  { value: 'Zoom in', label: 'Наезд' },
  { value: 'Dolly in', label: 'Долли' },
  { value: 'Handheld', label: 'С руки' },
  { value: 'Orbit', label: 'Орбита' },
  { value: 'Pan', label: 'Панорама' },
];

function StepCard({
  image,
  title,
  description,
}: {
  image: string;
  title: string;
  description: string;
}) {
  return (
    <article className="min-w-0">
      <div className="relative overflow-hidden rounded-[22px] bg-black p-3">
        <img src={image} alt="" className="aspect-[4/3] w-full rounded-[16px] object-cover" />
        <div className="pointer-events-none absolute inset-3 rounded-[16px] ring-2 ring-white/80" />
      </div>
      <h3 className="mt-5 text-xl font-black uppercase tracking-normal text-white md:text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
    </article>
  );
}

export default function VideoStudio() {
  const [searchParams] = useSearchParams();
  const resultRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('seedance-2');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('9:16');
  const [duration, setDuration] = useState<VideoDuration>(10);
  const [selectedStylePreset, setSelectedStylePreset] = useState<VideoStylePreset>('Cinematic');
  const [selectedCameraMotion, setSelectedCameraMotion] = useState<CameraMotion>('Dolly in');
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [referenceImagePreview, setReferenceImagePreview] = useState('');
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [referenceAudioFile, setReferenceAudioFile] = useState<File | null>(null);
  const [currentGeneration, setCurrentGeneration] = useState<VideoGenerationRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generations, setGenerations] = useState<VideoGenerationRequest[]>([]);
  const [mainTab, setMainTab] = useState<'Создать видео' | 'История' | 'Как это работает' | 'Cinema Studio' | 'CapCut'>('Создать видео');
  const [capCutPrompt, setCapCutPrompt] = useState('');
  const [capCutInputMode, setCapCutInputMode] = useState<'Image' | 'Video'>('Video');
  const [cinemaInputMode, setCinemaInputMode] = useState<'Image' | 'Video'>(
    () => (sessionStorage.getItem('cinemaInputMode') as 'Image' | 'Video') ?? 'Image'
  );
  const [cinemaPrompt, setCinemaPrompt] = useState('');
  const [cinemaAspect, setCinemaAspect] = useState('16:9');
  const [cinemaQuality, setCinemaQuality] = useState('2K');
  const [cinemaDuration, setCinemaDuration] = useState<5 | 10 | 15>(5);
  const [cinemaModelId, setCinemaModelId] = useState('seedance-2');
  const [cinemaModelPickerOpen, setCinemaModelPickerOpen] = useState(false);
  const [cinemaAspectPickerOpen, setCinemaAspectPickerOpen] = useState(false);
  const [cinemaQualityPickerOpen, setCinemaQualityPickerOpen] = useState(false);
  const [cinemaDurationPickerOpen, setCinemaDurationPickerOpen] = useState(false);
  const [cinemaSamples, setCinemaSamples] = useState(1);
  const [slotImages, setSlotImages] = useState<Record<string, string>>({});
  const slotFileInputRef = useRef<HTMLInputElement | null>(null);
  const slotVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSegForVideo, setActiveSegForVideo] = useState('');
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [segmentGenerationIds, setSegmentGenerationIds] = useState<Record<string, string>>({});
  const [segmentVideos, setSegmentVideos] = useState<Record<string, string>>({});
  const pollIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const [playerSegIdx, setPlayerSegIdx] = useState(0);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [segmentDurations, setSegmentDurations] = useState<Record<string, number>>({});
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const completedSegsRef = useRef<string[]>([]);
  const pendingPlayRef = useRef(false);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [barHover, setBarHover] = useState<{ pct: number; time: number } | null>(null);
  const [volumeState, setVolumeState] = useState<'max' | 'medium' | 'mute'>('max');
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [mediaPickerTab, setMediaPickerTab] = useState('Загрузки');
  const [elementCategoryFilter, setElementCategoryFilter] = useState<'all' | 'pinned' | VideoElementCategory>('all');
  const [elementSearch, setElementSearch] = useState('');
  const [elementSearchOpen, setElementSearchOpen] = useState(false);
  // Firestore elements
  const [elements, setElements] = useState<VideoElement[]>([]);
  // New element form
  const [newElementOpen, setNewElementOpen] = useState(false);
  const [newElementName, setNewElementName] = useState('');
  const [newElementCategory, setNewElementCategory] = useState<VideoElementCategory>('general');
  const [newElementImageFile, setNewElementImageFile] = useState<File | null>(null);
  const [newElementImagePreview, setNewElementImagePreview] = useState('');
  const [newElementDescription, setNewElementDescription] = useState('');
  const [newElementSaving, setNewElementSaving] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeToUserVideoGenerations(user.uid, (items) => {
      setGenerations(items);
    }, () => {});
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeToCredits(user.uid, setCredits, () => {});
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeToUserVideoElements(user.uid, setElements, () => {});
  }, [user]);

  useEffect(() => {
    if (!currentGeneration?.id) return;
    const updated = generations.find((g) => g.id === currentGeneration.id);
    if (updated && updated.updatedAt?.toMillis() !== currentGeneration.updatedAt?.toMillis()) {
      setCurrentGeneration(updated);
    }
  }, [generations, currentGeneration?.id]);

  useEffect(() => {
    const promptFromUrl = searchParams.get('prompt');
    if (promptFromUrl) setPrompt(promptFromUrl);
  }, [searchParams]);

  useEffect(() => {
    const generationId = searchParams.get('generation');
    if (!generationId) return;
    void getVideoGeneration(generationId).then((generation) => {
      if (!generation) return;
      setCurrentGeneration(generation);
      setPrompt(generation.prompt);
      setAspectRatio(generation.aspectRatio);
      setDuration(generation.duration);
    });
  }, [searchParams]);

  // When a segment generation completes in Firestore, update segmentVideos + stop polling
  useEffect(() => {
    for (const [seg, genId] of Object.entries(segmentGenerationIds)) {
      const gen = generations.find((g) => g.id === genId);
      if (gen?.status === 'completed' && gen.resultVideoUrl && !segmentVideos[seg]) {
        setSegmentVideos((prev) => ({ ...prev, [seg]: gen.resultVideoUrl! }));
        // Stop polling for this segment
        if (pollIntervalsRef.current[seg]) {
          clearInterval(pollIntervalsRef.current[seg]);
          delete pollIntervalsRef.current[seg];
        }
      }
      if (gen?.status === 'failed' && pollIntervalsRef.current[seg]) {
        clearInterval(pollIntervalsRef.current[seg]);
        delete pollIntervalsRef.current[seg];
      }
    }
  }, [generations, segmentGenerationIds, segmentVideos]);

  // Apply volume to video element when volumeState changes
  useEffect(() => {
    const v = playerVideoRef.current;
    if (!v) return;
    if (volumeState === 'max') { v.muted = false; v.volume = 1; }
    else if (volumeState === 'medium') { v.muted = false; v.volume = 0.5; }
    else { v.muted = true; v.volume = 0; }
  }, [volumeState]);

  function cycleVolume() {
    setVolumeState((s) => s === 'max' ? 'medium' : s === 'medium' ? 'mute' : 'max');
  }

  // Track fullscreen state changes (e.g. user presses ESC)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  function toggleFullscreen() {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      void playerContainerRef.current.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }

  // Poll Replicate status via worker every 6s for active segments
  function startSegmentPolling(segNum: string, generationId: string) {
    if (pollIntervalsRef.current[segNum]) clearInterval(pollIntervalsRef.current[segNum]);
    pollIntervalsRef.current[segNum] = setInterval(() => {
      void callWorker('checkVideoGeneration', { generationId });
    }, 6000);
  }

  const canGenerate = useMemo(() => Boolean(prompt.trim()) && Boolean(user), [prompt, user]);

  // Elements mentioned in prompt via @handle
  const mentionedElements = useMemo(() => {
    const mentions = extractMentions(prompt);
    return findElementsByMentions(elements, mentions);
  }, [prompt, elements]);

  // Full reference resolution + prompt enrichment (for UI preview)
  const resolvedContext = useMemo(
    () => buildGenerationContext(modelId, prompt.trim(), mentionedElements),
    [modelId, prompt, mentionedElements],
  );

  // Filtered elements for media picker
  const filteredElements = useMemo(() => {
    let list = elements;
    if (elementCategoryFilter === 'pinned') list = list.filter((e) => e.pinned);
    else if (elementCategoryFilter !== 'all') list = list.filter((e) => e.category === elementCategoryFilter);
    if (elementSearch.trim()) {
      const q = elementSearch.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q) || e.handle.toLowerCase().includes(q));
    }
    return list;
  }, [elements, elementCategoryFilter, elementSearch]);

  async function handleAnonymousSignIn() {
    setError('');
    await signInAnonymously(auth);
  }

  async function runCinemaVideoGeneration() {
    if (!cinemaPrompt.trim()) return;
    // Auto sign-in anonymously if needed
    let activeUser = user;
    if (!activeUser) {
      try {
        const { user: anonUser } = await signInAnonymously(auth);
        activeUser = anonUser;
      } catch {
        setError('Не удалось войти. Обновите страницу.');
        return;
      }
    }
    setLoading(true);
    setError('');
    setNotice('');
    setCurrentGeneration(null);

    try {
      async function blobUrlToDataUrl(url: string): Promise<string> {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      // Find which segment to generate: first one that has images but no video and no active generation
      const targetSeg = Array.from({ length: cinemaSamples }, (_, i) => String(i + 1)).find((seg) =>
        (slotImages[`${seg}.1`] || slotImages[`${seg}.2`]) &&
        !segmentVideos[seg] &&
        !segmentGenerationIds[seg]
      ) ?? '1';

      const firstFrameUrl = slotImages[`${targetSeg}.1`] ? await blobUrlToDataUrl(slotImages[`${targetSeg}.1`]) : undefined;
      const lastFrameUrl = slotImages[`${targetSeg}.2`] ? await blobUrlToDataUrl(slotImages[`${targetSeg}.2`]) : undefined;
      const mode: VideoGenerationMode = firstFrameUrl ? 'image_to_video' : 'text_to_video';

      const generation = await generateVideo(activeUser.uid, {
        prompt: cinemaPrompt.trim(),
        modelId: cinemaModelId,
        mode,
        aspectRatio: cinemaAspect as VideoAspectRatio,
        duration: cinemaDuration,
        stylePreset: 'Cinematic',
        cameraMotion: 'Static',
        referenceImageUrl: firstFrameUrl,
        lastFrameImageUrl: lastFrameUrl,
      });
      setCurrentGeneration(generation);
      setSegmentGenerationIds((prev) => ({ ...prev, [targetSeg]: generation.id }));
      startSegmentPolling(targetSeg, generation.id);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function runGeneration() {
    if (!user || !prompt.trim()) return;

    setLoading(true);
    setError('');
    setNotice('');
    setCurrentGeneration(null);

    const ctx = buildGenerationContext(modelId, prompt.trim(), mentionedElements);
    const hasVisualRef = referenceImageFile || ctx.referenceImageUrls.length > 0;
    const mode: VideoGenerationMode = hasVisualRef ? 'image_to_video' : 'text_to_video';
    const enrichedIsDifferent = ctx.enrichedPrompt !== prompt.trim();

    try {
      const generation = await generateVideo(user.uid, {
        prompt: prompt.trim(),
        enrichedPrompt: enrichedIsDifferent ? ctx.enrichedPrompt : undefined,
        modelId,
        mode,
        aspectRatio,
        duration,
        stylePreset: selectedStylePreset,
        cameraMotion: selectedCameraMotion,
        referenceImageFile,
        referenceVideoFile,
        referenceAudioFile,
        referenceImageUrls: ctx.referenceImageUrls.length > 0 ? ctx.referenceImageUrls : undefined,
        referenceImageUrl: ctx.referenceImageUrls[0],
        elements: [...ctx.visualRefs, ...ctx.textRefs],
        referenceMode: videoModels.find((m) => m.id === modelId)?.capabilities.referenceMode,
        referenceCount: ctx.referenceImageUrls.length,
      });
      setCurrentGeneration(generation);
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Generation failed.');
    } finally {
      setLoading(false);
    }
  }


  function copyPrompt() {
    void navigator.clipboard.writeText(currentGeneration?.prompt || prompt);
    setNotice('Промпт скопирован.');
  }

  async function saveToGallery() {
    if (!currentGeneration?.id) return;
    const alreadySaved = currentGeneration.saved;
    try {
      await toggleSavedVideoGeneration(currentGeneration.id, !alreadySaved);
      setCurrentGeneration((prev) => prev ? { ...prev, saved: !alreadySaved } : prev);
      setNotice(alreadySaved ? 'Удалено из сохранённых.' : 'Сохранено в галерею.');
    } catch {
      setNotice('Не удалось сохранить.');
    }
  }

  function enhancePrompt() {
    const basePrompt = prompt.trim();
    if (!basePrompt) return;
    const motionHint = referenceImageFile
      ? `Animate this photo: ${basePrompt}. Smooth natural motion, ${selectedCameraMotion} camera movement, ${selectedStylePreset} style, ${duration}s.`
      : `${basePrompt}. ${selectedStylePreset} style, ${selectedCameraMotion} camera, ${aspectRatio} format, ${duration}s, cinematic quality.`;
    setPrompt(motionHint);
    setNotice('Промпт улучшен.');
  }

  function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setReferenceImageFile(null);
    setReferenceImagePreview('');
    setReferenceVideoFile(null);
    setReferenceAudioFile(null);

    if (!selectedFile) return;
    if (selectedFile.type.startsWith('image/')) {
      setReferenceImageFile(selectedFile);
      setReferenceImagePreview(URL.createObjectURL(selectedFile));
    }
    if (selectedFile.type.startsWith('video/')) setReferenceVideoFile(selectedFile);
    if (selectedFile.type.startsWith('audio/')) setReferenceAudioFile(selectedFile);
    setMediaPickerOpen(false);
  }

  function handleSlotImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeSlot) return;
    const url = URL.createObjectURL(file);
    setSlotImages((prev) => ({ ...prev, [activeSlot]: url }));
    e.target.value = '';
  }

  function openSlotPicker(label: string) {
    setActiveSlot(label);
    slotFileInputRef.current?.click();
  }

  function handleSlotVideoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeSegForVideo) return;
    const url = URL.createObjectURL(file);
    setSegmentVideos((prev) => ({ ...prev, [activeSegForVideo]: url }));
    e.target.value = '';
  }

  function openSlotVideoPicker(segNum: string) {
    setActiveSegForVideo(segNum);
    slotVideoInputRef.current?.click();
  }

  async function handleSaveVideo() {
    const segs = (['1','2','3','4'] as const).filter((s) => segmentVideos[s]);
    if (segs.length === 0 || isSaving) return;

    setIsSaving(true);
    setSaveProgress(0);

    try {
      const videoEl = document.createElement('video');
      videoEl.muted = true;
      videoEl.playsInline = true;

      // Get dimensions from first segment
      await new Promise<void>((resolve, reject) => {
        videoEl.src = segmentVideos[segs[0]];
        videoEl.onloadedmetadata = () => resolve();
        videoEl.onerror = () => reject(new Error('Failed to load video'));
      });

      const w = videoEl.videoWidth || 1280;
      const h = videoEl.videoHeight || 720;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(100);

      for (let i = 0; i < segs.length; i++) {
        await new Promise<void>((resolve, reject) => {
          videoEl.src = segmentVideos[segs[i]];
          videoEl.currentTime = 0;
          let rafId: number;

          const draw = () => {
            if (!videoEl.ended && !videoEl.paused) {
              ctx.drawImage(videoEl, 0, 0, w, h);
              rafId = requestAnimationFrame(draw);
            }
          };

          videoEl.oncanplay = () => {
            videoEl.play().then(() => { rafId = requestAnimationFrame(draw); }).catch(reject);
          };
          videoEl.onended = () => {
            cancelAnimationFrame(rafId);
            ctx.drawImage(videoEl, 0, 0, w, h);
            setSaveProgress(Math.round(((i + 1) / segs.length) * 100));
            resolve();
          };
          videoEl.onerror = () => reject(new Error(`Failed to load segment ${segs[i]}`));
        });
      }

      recorder.stop();
      await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cinema-studio.webm';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Save video failed:', err);
    } finally {
      setIsSaving(false);
      setSaveProgress(0);
    }
  }

  function clearReferenceImage() {
    if (referenceImagePreview) URL.revokeObjectURL(referenceImagePreview);
    setReferenceImageFile(null);
    setReferenceImagePreview('');
  }

  const mode: VideoGenerationMode = referenceImageFile ? 'image_to_video' : 'text_to_video';

  function handleNewElementImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setNewElementImageFile(file);
    if (file) {
      setNewElementImagePreview(URL.createObjectURL(file));
    } else {
      setNewElementImagePreview('');
    }
  }

  function openNewElementForm() {
    setNewElementOpen(true);
    setNewElementName('');
    setNewElementCategory('general');
    setNewElementImageFile(null);
    setNewElementImagePreview('');
    setNewElementDescription('');
  }

  function closeNewElementForm() {
    setNewElementOpen(false);
    if (newElementImagePreview) URL.revokeObjectURL(newElementImagePreview);
    setNewElementImagePreview('');
  }

  async function saveNewElement() {
    const name = newElementName.trim();
    if (!name || !user || newElementSaving) return;
    setNewElementSaving(true);
    try {
      const elementRef = doc(collection(db, 'video_elements'));
      let imageUrl = '';
      let storagePath = '';
      if (newElementImageFile) {
        const uploaded = await uploadElementImage(user.uid, elementRef.id, newElementImageFile);
        imageUrl = uploaded.imageUrl;
        storagePath = uploaded.storagePath;
      }
      const handle = buildHandle(name);
      const now = Timestamp.now();
      const element: VideoElement = {
        id: elementRef.id,
        userId: user.uid,
        name,
        handle,
        category: newElementCategory,
        imageUrl,
        storagePath,
        description: newElementDescription.trim() || undefined,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveVideoElement(element);
      setNotice(`${handle} сохранён.`);
      closeNewElementForm();
    } catch (err) {
      setNotice('Ошибка сохранения элемента.');
    } finally {
      setNewElementSaving(false);
    }
  }

  async function handleDeleteElement(element: VideoElement) {
    try {
      await deleteVideoElement(element);
      setNotice(`${element.handle} удалён.`);
    } catch {
      setNotice('Ошибка удаления.');
    }
  }

  async function handleTogglePin(element: VideoElement) {
    await togglePinVideoElement(element.id, !element.pinned);
  }

  return (
    <main className="min-h-screen bg-[#0b0d0f] text-white">
      <form onSubmit={(e) => { e.preventDefault(); void runGeneration(); }} className={`flex min-h-screen flex-col ${mainTab !== 'Cinema Studio' && mainTab !== 'CapCut' ? 'lg:flex-row' : ''}`}>
        <aside className={`w-full border-b border-white/10 bg-[#111315] lg:min-h-screen lg:w-[360px] lg:border-b-0 lg:border-r lg:overflow-y-auto${mainTab === 'Cinema Studio' || mainTab === 'CapCut' ? ' hidden' : ''}`}>
          {/* Навигация */}
          <div className="flex gap-1 border-b border-white/8 p-3 text-sm font-bold">
            <button type="button" className="rounded-xl bg-white/10 px-4 py-2.5 text-white">Создать</button>
            <Link to="/video-dashboard" className="rounded-xl px-4 py-2.5 text-slate-400 hover:text-white">Панель</Link>
            <Link to="/video-settings" className="rounded-xl px-4 py-2.5 text-slate-400 hover:text-white">Настройки</Link>
          </div>

          <div className="space-y-3 p-4">

            {/* Режим генерации */}
            <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.04] p-1 text-xs font-bold">
              <span className={`flex-1 rounded-lg py-2 text-center transition ${mode === 'text_to_video' ? 'bg-white text-black' : 'text-slate-400'}`}>
                Текст → Видео
              </span>
              <span className={`flex-1 rounded-lg py-2 text-center transition ${mode === 'image_to_video' ? 'bg-[#d7ff00] text-black' : 'text-slate-400'}`}>
                Фото → Видео
              </span>
            </div>

            {/* Загрузка фото — главный блок */}
            {referenceImagePreview ? (
              <div className="relative overflow-hidden rounded-2xl bg-black">
                <img src={referenceImagePreview} alt="Референс" className="w-full object-cover" style={{ maxHeight: 220 }} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                  <div>
                    <span className="rounded-full bg-[#d7ff00] px-2 py-0.5 text-[10px] font-black text-black">Фото → Видео</span>
                    <p className="mt-1 text-xs text-slate-300 truncate max-w-[160px]">{referenceImageFile?.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearReferenceImage}
                    className="grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white hover:bg-red-500/80 transition"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <label className="absolute inset-0 cursor-pointer">
                  <input type="file" accept="image/*" className="sr-only" onChange={handleReferenceUpload} />
                </label>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.03] py-8 text-center transition hover:border-[#d7ff00]/40 hover:bg-white/[0.06]">
                <span className="grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/8 text-slate-300">
                  <ImageIcon className="h-7 w-7" />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">Загрузите фото</p>
                  <p className="mt-1 text-xs text-slate-500">JPG, PNG, WEBP · до 20 МБ</p>
                </div>
                <span className="rounded-full bg-white/8 px-4 py-1.5 text-xs font-bold text-slate-300">или выбрать из медиатеки</span>
                <input type="file" accept="image/*" className="sr-only" onChange={handleReferenceUpload} />
              </label>
            )}

            {/* Кнопка открытия медиапикера */}
            <button
              type="button"
              onClick={() => setMediaPickerOpen(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-white/8 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/[0.07]"
            >
              <div className="flex gap-1 text-slate-400">
                <ImageIcon className="h-4 w-4" />
                <FileVideo className="h-4 w-4" />
                <FileAudio className="h-4 w-4" />
              </div>
              <span className="flex-1 text-left text-xs">Медиатека, элементы, понравившееся</span>
              <Plus className="h-4 w-4 shrink-0" />
            </button>

            {/* Промпт */}
            <PromptEditor
              value={prompt}
              onChange={setPrompt}
              elements={elements}
              onEnhance={enhancePrompt}
              placeholder={mode === 'image_to_video'
                ? 'Опишите движение. Напишите @ чтобы добавить элемент.'
                : 'Опишите сцену. Напишите @ чтобы добавить элемент.'}
            />

            {/* Движение камеры */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Движение камеры</p>
              <div className="grid grid-cols-3 gap-1.5">
                {cameraMotions.map((cm) => (
                  <button
                    key={cm.value}
                    type="button"
                    onClick={() => setSelectedCameraMotion(cm.value)}
                    className={`rounded-lg py-2 text-xs font-bold transition ${selectedCameraMotion === cm.value ? 'bg-white text-black' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]'}`}
                  >
                    {cm.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Пресет стиля */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Стиль</p>
              <div className="grid grid-cols-2 gap-1.5">
                {stylePresets.map((sp) => (
                  <button
                    key={sp.value}
                    type="button"
                    onClick={() => setSelectedStylePreset(sp.value)}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${selectedStylePreset === sp.value ? 'bg-[#d7ff00] text-black' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]'}`}
                  >
                    <span>{sp.emoji}</span>
                    {sp.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Длительность */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Длительность</p>
              <div className="grid grid-cols-3 gap-1.5">
                {durationOptions.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setDuration(entry)}
                    className={`flex items-center justify-center gap-1 rounded-lg py-2.5 text-sm font-black transition ${duration === entry ? 'bg-[#d7ff00] text-black' : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'}`}
                  >
                    <Clock3 className="h-3.5 w-3.5" />
                    {entry}с
                  </button>
                ))}
              </div>
            </div>

            {/* Соотношение сторон */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Формат</p>
              <div className="grid grid-cols-3 gap-1.5">
                {aspectOptions.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setAspectRatio(entry)}
                    className={`flex items-center justify-center gap-1 rounded-lg py-2.5 text-sm font-black transition ${aspectRatio === entry ? 'bg-[#d7ff00] text-black' : 'bg-white/[0.06] text-slate-200 hover:bg-white/[0.1]'}`}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    {entry}
                  </button>
                ))}
              </div>
            </div>

            {/* Модель */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Модель</p>
              <button
                type="button"
                onClick={() => setModelPickerOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-black text-white truncate">
                    {videoModels.find((m) => m.id === modelId)?.name ?? modelId}
                  </span>
                  {videoModels.find((m) => m.id === modelId)?.status === 'active' ? (
                    <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Active</span>
                  ) : null}
                </div>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${modelPickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {modelPickerOpen ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d0f11]">
                  {videoModels.map((model) => {
                    const isActive = model.status === 'active';
                    const isSelected = model.id === modelId;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={!isActive}
                        onClick={() => {
                          if (!isActive) return;
                          setModelId(model.id);
                          setModelPickerOpen(false);
                        }}
                        className={`flex w-full items-start gap-3 border-b border-white/[0.06] px-4 py-3 text-left last:border-0 transition
                          ${isSelected ? 'bg-white/[0.06]' : ''}
                          ${isActive ? 'hover:bg-white/[0.05]' : 'opacity-40 cursor-not-allowed'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${isSelected ? 'text-[#d7ff00]' : 'text-white'}`}>{model.name}</span>
                            {model.status === 'coming_soon' ? (
                              <span className="shrink-0 rounded-full bg-slate-600/40 px-2 py-0.5 text-[10px] font-bold text-slate-400">Скоро</span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Active</span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">{model.description}</p>
                          {model.estimatedCostLabel ? (
                            <p className="mt-0.5 text-[11px] font-bold text-slate-600">{model.estimatedCostLabel}</p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Reference Summary */}
            {mentionedElements.length > 0 ? (
              <ReferenceSummary
                resolved={resolvedContext}
                modelName={videoModels.find((m) => m.id === modelId)?.name}
              />
            ) : null}

            {/* Кредиты */}
            {user && credits !== null ? (
              <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.04] px-4 py-2.5">
                <span className="text-xs font-bold text-slate-400">Кредиты</span>
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-black ${credits < (MODEL_CREDIT_COST[modelId] ?? 10) ? 'text-rose-300' : 'text-[#d7ff00]'}`}>
                    {credits}
                  </span>
                  <span className="text-xs text-slate-500">−{MODEL_CREDIT_COST[modelId] ?? 10} за генерацию</span>
                </div>
              </div>
            ) : null}

            {/* Кнопка генерации */}
            <button
              type="submit"
              disabled={!canGenerate || loading}
              className="flex min-h-14 w-full flex-col items-center justify-center rounded-2xl bg-[#d7ff00] px-4 text-black shadow-[0_18px_60px_-28px_rgba(215,255,0,0.75)] transition hover:bg-[#e5ff33] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-base font-black">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                {loading ? 'Генерируем...' : mode === 'image_to_video' ? 'Анимировать фото' : 'Сгенерировать'}
              </span>
              <span className="text-[10px] font-bold opacity-60">
                via {videoModels.find((m) => m.id === modelId)?.name ?? modelId}
              </span>
            </button>

            {!user && !authLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
                <p className="text-sm text-slate-300">Войдите, чтобы генерировать видео.</p>
                <button type="button" onClick={handleAnonymousSignIn} className="mt-3 min-h-10 w-full rounded-xl bg-white text-sm font-black text-black">
                  Войти как гость
                </button>
              </div>
            ) : null}

          </div>
        </aside>

        <section className="min-w-0 flex-1 p-4 lg:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white/[0.035] p-1 text-sm font-bold text-slate-300">
              {(['Создать видео', 'Cinema Studio', 'CapCut', 'История', 'Как это работает'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setMainTab(tab)}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 transition ${
                    mainTab === tab
                      ? tab === 'Cinema Studio' ? 'bg-[#d7ff00]/15 text-[#d7ff00]'
                      : tab === 'CapCut' ? 'bg-[#ff3b5c]/15 text-[#ff3b5c]'
                      : 'bg-white/[0.08] text-white'
                    : 'hover:bg-white/[0.05] hover:text-white'
                  }`}
                >
                  {tab === 'История' && <Folder className="h-4 w-4" />}
                  {tab === 'Как это работает' && <BookOpen className="h-4 w-4" />}
                  {tab === 'Cinema Studio' && <PlayCircle className="h-4 w-4" />}
                  {tab === 'CapCut' && <FileVideo className="h-4 w-4" />}
                  {tab}
                </button>
              ))}
            </div>
            <Link to="/video-settings" className="flex min-h-10 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-sm font-bold text-slate-200 hover:text-white">
              <Settings className="h-4 w-4" />
              Настройки
            </Link>
          </div>

          {mainTab === 'Cinema Studio' ? (
            <section className="relative overflow-hidden rounded-[24px] bg-[#0b0d0f] lg:min-h-[720px]">

              {cinemaInputMode === 'Video' ? (
                /* ── STORYBOARD LAYOUT (Video mode) ── */
                <>
                  {/* Preview canvas / Player */}
                  {(() => {
                    const PALETTE = [
                      '#a855f7','#22c55e','#f97316','#3b82f6','#ec4899',
                      '#06b6d4','#eab308','#ef4444','#10b981','#8b5cf6',
                      '#f43f5e','#14b8a6','#f59e0b','#6366f1','#84cc16',
                      '#0ea5e9','#d946ef','#fb923c','#34d399','#818cf8',
                      '#fb7185','#2dd4bf','#fbbf24','#60a5fa','#a3e635',
                      '#38bdf8','#e879f9','#fdba74','#6ee7b7','#a5b4fc',
                      '#fda4af','#5eead4','#fcd34d','#93c5fd','#bef264',
                      '#7dd3fc','#f0abfc','#fed7aa','#a7f3d0','#c7d2fe',
                      '#fecdd3','#99f6e4','#fde68a','#bfdbfe','#d9f99d',
                      '#bae6fd','#f5d0fe','#ffedd5','#d1fae5','#e0e7ff',
                    ];
                    const getSegColor = (i: number) => PALETTE[i % PALETTE.length];

                    const completedSegs = Object.keys(segmentVideos).filter((s) => segmentVideos[s]).sort((a, b) => Number(a) - Number(b));
                    completedSegsRef.current = completedSegs;
                    const totalDur = completedSegs.reduce((sum, s) => sum + (segmentDurations[s] ?? 0), 0);
                    const elapsedBefore = completedSegs.slice(0, playerSegIdx).reduce((sum, s) => sum + (segmentDurations[s] ?? 0), 0);
                    const totalElapsed = elapsedBefore + playerCurrentTime;

                    const fmt = (s: number) => `${Math.floor(s)}s`;

                    const goTo = (idx: number, t = 0) => {
                      setPlayerSegIdx(idx);
                      setPlayerCurrentTime(t);
                      if (playerVideoRef.current) { playerVideoRef.current.currentTime = t; }
                    };

                    const handleBack = () => {
                      if (playerCurrentTime > 2) { goTo(playerSegIdx, 0); }
                      else if (playerSegIdx > 0) { goTo(playerSegIdx - 1, 0); }
                    };

                    const handleForward = () => {
                      if (playerSegIdx < completedSegs.length - 1) { goTo(playerSegIdx + 1, 0); }
                    };

                    const togglePlay = () => {
                      const v = playerVideoRef.current;
                      if (!v) return;
                      if (playerPlaying) { v.pause(); setPlayerPlaying(false); }
                      else { void v.play().catch(() => {}); setPlayerPlaying(true); }
                    };

                    const curSeg = completedSegs[playerSegIdx] ?? completedSegs[0];
                    const hasVideo = completedSegs.length > 0;

                    return (
                      <div ref={playerContainerRef} className="absolute left-4 right-4 top-4 flex flex-col overflow-hidden rounded-2xl" style={{ bottom: 310, background: hasVideo ? '#000' : '#fff' }}>
                        {/* Video or placeholder */}
                        {hasVideo ? (
                          <video
                            ref={playerVideoRef}
                            key={curSeg}
                            src={segmentVideos[curSeg]}
                            className="min-h-0 flex-1 w-full object-contain"
                            onTimeUpdate={() => setPlayerCurrentTime(playerVideoRef.current?.currentTime ?? 0)}
                            onLoadedMetadata={() => {
                              const dur = playerVideoRef.current?.duration ?? 0;
                              setSegmentDurations((p) => ({ ...p, [curSeg]: dur }));
                            }}
                            onEnded={() => {
                              const segs = completedSegsRef.current;
                              if (playerSegIdx < segs.length - 1) {
                                pendingPlayRef.current = true;
                                setPlayerSegIdx(playerSegIdx + 1);
                                setPlayerCurrentTime(0);
                              } else {
                                setPlayerPlaying(false);
                              }
                            }}
                            onCanPlay={() => {
                              if (pendingPlayRef.current) {
                                pendingPlayRef.current = false;
                                void playerVideoRef.current?.play().catch(() => {});
                              }
                            }}
                            onPlay={() => setPlayerPlaying(true)}
                            onPause={() => setPlayerPlaying(false)}
                          />
                        ) : (
                          <div className="min-h-0 flex-1" />
                        )}

                        {/* Controls bar */}
                        <div className="flex flex-col gap-2 bg-[#111315] px-4 pb-3 pt-3">
                          {/* Multi-color seekable progress bars */}
                          <div
                            className="relative flex h-4 gap-1.5 cursor-pointer"
                            onMouseMove={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                              const time = totalDur > 0 ? pct * totalDur : 0;
                              setBarHover({ pct: pct * 100, time });
                            }}
                            onMouseLeave={() => setBarHover(null)}
                            onClick={(e) => {
                              if (completedSegs.length === 0) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                              if (totalDur > 0) {
                                const target = ratio * totalDur;
                                let elapsed = 0;
                                for (let i = 0; i < completedSegs.length; i++) {
                                  const d = segmentDurations[completedSegs[i]] ?? 0;
                                  if (target <= elapsed + d || i === completedSegs.length - 1) {
                                    goTo(i, Math.max(0, target - elapsed));
                                    break;
                                  }
                                  elapsed += d;
                                }
                              } else {
                                // Durations unknown — seek by segment index
                                const idx = Math.min(completedSegs.length - 1, Math.floor(ratio * completedSegs.length));
                                goTo(idx, 0);
                              }
                            }}
                          >
                            {completedSegs.length > 0 ? completedSegs.map((seg, i) => {
                              const color = getSegColor(i);
                              const dur = segmentDurations[seg] ?? 0;
                              const pct = totalDur > 0 ? (dur / totalDur) * 100 : 100 / completedSegs.length;
                              const fill = i < playerSegIdx ? 100 : (i === playerSegIdx && dur > 0) ? (playerCurrentTime / dur) * 100 : 0;
                              return (
                                <div key={seg} style={{ width: `${pct}%`, minWidth: 8, backgroundColor: color + '55' }} className="relative h-full rounded-full overflow-hidden flex-shrink-0">
                                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, backgroundColor: color, transition: 'width 0.25s linear' }} />
                                </div>
                              );
                            }) : (
                              <div className="h-full w-full rounded-full" style={{ backgroundColor: '#ffffff22' }} />
                            )}
                            {/* Hover cursor line + tooltip */}
                            {barHover && (
                              <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${barHover.pct}%` }}>
                                <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-white/90 shadow-lg" />
                                <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/90 px-2 py-1 text-[11px] font-bold text-white shadow-xl">
                                  {Math.floor(barHover.time)}s
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Buttons + time */}
                          <div className="flex items-center">
                            <span className="w-16 text-xs text-slate-500">{fmt(totalElapsed)}</span>
                            <div className="flex flex-1 items-center justify-center gap-5">
                              <button type="button" onClick={handleBack} disabled={!hasVideo} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-white transition disabled:opacity-30">
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
                              </button>
                              <button type="button" onClick={togglePlay} disabled={!hasVideo} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 disabled:opacity-30">
                                {playerPlaying
                                  ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>
                                  : <svg viewBox="0 0 24 24" className="h-5 w-5 translate-x-0.5" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                }
                              </button>
                              <button type="button" onClick={handleForward} disabled={playerSegIdx >= completedSegs.length - 1} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-white transition disabled:opacity-30">
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 3.9V8.1L8.5 12zM16 6h2v12h-2z"/></svg>
                              </button>
                            </div>
                            {/* Volume button */}
                            <button
                              type="button"
                              onClick={cycleVolume}
                              disabled={!hasVideo}
                              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.07] transition hover:bg-white/15 disabled:opacity-30"
                              style={{ color: volumeState === 'mute' ? '#ef4444' : volumeState === 'medium' ? '#fbbf24' : '#a3e635' }}
                              title={volumeState === 'max' ? 'Громко' : volumeState === 'medium' ? 'Средний' : 'Без звука'}
                            >
                              {volumeState === 'max' && <Volume2 className="h-4 w-4" />}
                              {volumeState === 'medium' && <Volume1 className="h-4 w-4" />}
                              {volumeState === 'mute' && <VolumeX className="h-4 w-4" />}
                            </button>
                            {/* Fullscreen button */}
                            <button
                              type="button"
                              onClick={toggleFullscreen}
                              disabled={!hasVideo}
                              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.07] text-slate-400 transition hover:bg-white/15 hover:text-white disabled:opacity-30"
                              title="На весь экран"
                            >
                              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                            </button>
                            {/* Save button */}
                            <button
                              type="button"
                              onClick={() => void handleSaveVideo()}
                              disabled={!hasVideo || isSaving}
                              className="flex items-center gap-1.5 rounded-xl bg-[#d7ff00]/10 px-3 py-1.5 text-xs font-bold text-[#d7ff00] transition hover:bg-[#d7ff00]/20 disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Склеить все сегменты и скачать"
                            >
                              {isSaving ? (
                                <>
                                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                                  {saveProgress}%
                                </>
                              ) : (
                                <>
                                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                                  Сохранить
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Hidden file input for slot images */}
                  <input
                    ref={slotFileInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleSlotImageChange}
                  />
                  {/* Hidden file input for slot video (Ctrl+click) */}
                  <input
                    ref={slotVideoInputRef}
                    type="file"
                    accept="video/*"
                    className="sr-only"
                    onChange={handleSlotVideoChange}
                  />

                  {/* Card strip — sits directly above bottom bar */}
                  <div className="absolute left-4 right-4 flex gap-3 rounded-2xl bg-[#cecece] p-3" style={{ bottom: 148 }}>
                    {Array.from({ length: cinemaSamples }, (_, i) => [`${i+1}.1`, `${i+1}.2`] as [string, string]).map(([a, b]) => {
                      const segNum = a.split('.')[0];
                      const segVideo = segmentVideos[segNum];
                      const segGenId = segmentGenerationIds[segNum];
                      const segGen = segGenId ? generations.find((g) => g.id === segGenId) : null;
                      const isGenerating = segGen && (segGen.status === 'pending' || segGen.status === 'processing');
                      const isFailed = segGen?.status === 'failed';

                      // Merged state: show video, spinner, or error
                      if (segVideo || isGenerating || isFailed) {
                        return (
                          <div key={a} className="group relative flex flex-1 overflow-hidden rounded-2xl bg-[#4a4b4d]" style={{ minHeight: 120 }}>
                            {segVideo ? (
                              <video
                                src={segVideo}
                                className="absolute inset-0 h-full w-full object-cover"
                                autoPlay
                                loop
                                muted
                                playsInline
                              />
                            ) : isFailed ? (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
                                <span className="text-lg">⚠️</span>
                                <span className="text-center text-[10px] font-bold text-red-400">ошибка</span>
                                <button
                                  type="button"
                                  onClick={() => setSegmentGenerationIds((p) => { const n = {...p}; delete n[segNum]; return n; })}
                                  className="mt-1 rounded-full bg-white/10 px-2 py-0.5 text-[9px] text-white/60 hover:bg-white/20"
                                >
                                  повтор
                                </button>
                              </div>
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                <Loader2 className="h-7 w-7 animate-spin text-white/60" />
                                <span className="text-[10px] font-bold text-white/50">генерация...</span>
                              </div>
                            )}
                            <span className="absolute left-2 top-2 z-10 text-[11px] font-bold text-white drop-shadow">{segNum}</span>
                            {/* Trash button — appears on hover */}
                            <button
                              type="button"
                              onClick={() => {
                                setSegmentVideos((p) => { const n = {...p}; delete n[segNum]; return n; });
                                setSegmentGenerationIds((p) => { const n = {...p}; delete n[segNum]; return n; });
                              }}
                              className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/70 opacity-0 transition-opacity hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      }

                      // Default: two upload cards
                      return (
                      <div key={a} className="flex flex-1 gap-1.5">
                        {([a, b] as const).map((label) => (
                          <button
                            key={label}
                            type="button"
                            onClick={(e) => {
                              if (e.ctrlKey) {
                                openSlotVideoPicker(segNum);
                              } else {
                                openSlotPicker(label);
                              }
                            }}
                            title="Клик — фото | Ctrl+Клик — загрузить видео"
                            className="group relative flex flex-1 flex-col items-center justify-between overflow-hidden rounded-2xl bg-[#4a4b4d] px-2 pb-3 pt-2.5 transition hover:bg-[#555658]"
                            style={{ minHeight: 120 }}
                          >
                            {slotImages[label] ? (
                              <>
                                <img
                                  src={slotImages[label]}
                                  alt={label}
                                  className="absolute inset-0 h-full w-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/30" />
                                <span className="relative z-10 text-[11px] font-bold text-white drop-shadow">{label}</span>
                                <div className="relative z-10 mt-auto rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white">изменить</div>
                                {/* Trash button */}
                                <div
                                  role="button"
                                  onClick={(e) => { e.stopPropagation(); setSlotImages((p) => { const n = {...p}; delete n[label]; return n; }); }}
                                  className="absolute right-1.5 top-1.5 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white/70 opacity-0 transition-opacity hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="text-[11px] font-bold text-white/70">{label}</span>
                                <Images className="h-7 w-7 text-white/50" />
                                <span className="text-base font-bold text-white/60">+</span>
                              </>
                            )}
                          </button>
                        ))}
                      </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                /* ── HERO LAYOUT (Image mode) ── */
                <>
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#d7ff00]/[0.04] blur-[120px]" />
                  </div>
                  <div className="flex flex-col items-center justify-center px-6 pb-52 pt-16 text-center lg:pt-24">
                    <div className="relative mb-10 h-48 w-72 sm:h-52 sm:w-80">
                      <div className="absolute inset-0 -rotate-6 scale-90 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/50">
                        <img src="https://picsum.photos/seed/cinema1/640/360" alt="" className="h-full w-full object-cover opacity-60" />
                      </div>
                      <div className="absolute inset-0 rotate-3 scale-95 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/50">
                        <img src="https://picsum.photos/seed/cinema2/640/360" alt="" className="h-full w-full object-cover opacity-75" />
                      </div>
                      <div className="absolute inset-0 overflow-hidden rounded-2xl border border-white/15 bg-[#1a1c1f] shadow-2xl shadow-black/70">
                        <img src="https://picsum.photos/seed/cinema3/640/360" alt="" className="h-full w-full object-cover" />
                      </div>
                    </div>
                    <h2 className="max-w-2xl text-4xl font-black uppercase leading-[0.92] tracking-tight text-white sm:text-5xl lg:text-6xl">
                      Create your first project.{' '}
                      <span className="text-[#d7ff00]">Generate the impossible.</span>
                    </h2>
                  </div>
                </>
              )}

              {/* Cinema Studio error banner */}
              {error && (
                <div className="absolute bottom-[148px] left-4 right-4 z-50 flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2.5 text-sm text-red-400">
                  <X className="h-4 w-4 shrink-0" />
                  {error}
                  <button type="button" onClick={() => setError('')} className="ml-auto text-red-400/60 hover:text-red-400">✕</button>
                </div>
              )}

              {/* Bottom input bar — fixed to bottom of section */}
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 sm:px-8">
                <div className="mx-auto max-w-3xl">
                  <div className="flex items-stretch gap-3 rounded-2xl border border-white/10 bg-[#141618] p-2 shadow-2xl shadow-black/60 backdrop-blur-xl">

                    {/* Image / Video toggle */}
                    <div className="flex flex-col gap-1">
                      {(['Image', 'Video'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setCinemaInputMode(mode); sessionStorage.setItem('cinemaInputMode', mode); }}
                          className={`flex h-10 w-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold transition ${cinemaInputMode === mode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          {mode === 'Image' ? <ImageIcon className="h-4 w-4" /> : <FileVideo className="h-4 w-4" />}
                          {mode}
                        </button>
                      ))}
                    </div>

                    {/* Prompt + settings */}
                    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                      <input
                        type="text"
                        value={cinemaPrompt}
                        onChange={(e) => setCinemaPrompt(e.target.value)}
                        placeholder="Describe what you want to create..."
                        className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      />
                      {/* Settings chips */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Model picker chip */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setCinemaModelPickerOpen((o) => !o)}
                            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10"
                          >
                            <span>🎬</span>
                            {videoModels.find((m) => m.id === cinemaModelId)?.name ?? 'Модель'}
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </button>

                          {cinemaModelPickerOpen && (
                            <>
                              {/* Backdrop */}
                              <div className="fixed inset-0 z-40" onClick={() => setCinemaModelPickerOpen(false)} />
                              {/* Dropdown */}
                              <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/60">
                                <div className="border-b border-white/10 px-4 py-2.5">
                                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Выберите модель</span>
                                </div>
                                <div className="max-h-72 overflow-y-auto py-1.5">
                                  {videoModels.map((m) => (
                                    <button
                                      key={m.id}
                                      type="button"
                                      onClick={() => { setCinemaModelId(m.id); setCinemaModelPickerOpen(false); }}
                                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.06] ${cinemaModelId === m.id ? 'bg-white/[0.08]' : ''}`}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-bold text-white truncate">{m.name}</span>
                                          {m.status === 'active' && (
                                            <span className="shrink-0 rounded-full bg-[#d7ff00]/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-[#d7ff00]">live</span>
                                          )}
                                        </div>
                                        <span className="text-[11px] text-slate-500">{m.provider} · {m.estimatedCostLabel}</span>
                                      </div>
                                      {cinemaModelId === m.id && (
                                        <div className="h-2 w-2 shrink-0 rounded-full bg-[#d7ff00]" />
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                        {/* Aspect ratio picker */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => { setCinemaAspectPickerOpen((o) => !o); setCinemaQualityPickerOpen(false); setCinemaDurationPickerOpen(false); }}
                            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10"
                          >
                            {cinemaAspect}
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </button>
                          {cinemaAspectPickerOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setCinemaAspectPickerOpen(false)} />
                              <div className="absolute bottom-full left-0 z-50 mb-2 w-36 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/60">
                                <div className="border-b border-white/10 px-3 py-2">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Соотношение</span>
                                </div>
                                {(['16:9', '9:16', '1:1'] as const).map((r) => (
                                  <button key={r} type="button"
                                    onClick={() => { setCinemaAspect(r); setCinemaAspectPickerOpen(false); }}
                                    className={`flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold transition hover:bg-white/[0.06] ${cinemaAspect === r ? 'bg-white/[0.08] text-white' : 'text-slate-300'}`}
                                  >
                                    {r}
                                    {cinemaAspect === r && <div className="h-2 w-2 rounded-full bg-[#d7ff00]" />}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Quality picker */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => { setCinemaQualityPickerOpen((o) => !o); setCinemaAspectPickerOpen(false); setCinemaDurationPickerOpen(false); }}
                            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10"
                          >
                            {cinemaQuality}
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </button>
                          {cinemaQualityPickerOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setCinemaQualityPickerOpen(false)} />
                              <div className="absolute bottom-full left-0 z-50 mb-2 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/60">
                                <div className="border-b border-white/10 px-3 py-2">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Качество</span>
                                </div>
                                {(['1K', '2K', '4K'] as const).map((q) => (
                                  <button key={q} type="button"
                                    onClick={() => { setCinemaQuality(q); setCinemaQualityPickerOpen(false); }}
                                    className={`flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold transition hover:bg-white/[0.06] ${cinemaQuality === q ? 'bg-white/[0.08] text-white' : 'text-slate-300'}`}
                                  >
                                    {q}
                                    {cinemaQuality === q && <div className="h-2 w-2 rounded-full bg-[#d7ff00]" />}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        {/* Duration picker */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => { setCinemaDurationPickerOpen((o) => !o); setCinemaAspectPickerOpen(false); setCinemaQualityPickerOpen(false); }}
                            className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10"
                          >
                            {cinemaDuration}s
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </button>
                          {cinemaDurationPickerOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setCinemaDurationPickerOpen(false)} />
                              <div className="absolute bottom-full left-0 z-50 mb-2 w-32 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/60">
                                <div className="border-b border-white/10 px-3 py-2">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Длительность</span>
                                </div>
                                {([5, 10, 15] as const).map((d) => (
                                  <button key={d} type="button"
                                    onClick={() => { setCinemaDuration(d); setCinemaDurationPickerOpen(false); }}
                                    className={`flex w-full items-center justify-between px-3 py-2.5 text-sm font-bold transition hover:bg-white/[0.06] ${cinemaDuration === d ? 'bg-white/[0.08] text-white' : 'text-slate-300'}`}
                                  >
                                    {d} сек
                                    {cinemaDuration === d && <div className="h-2 w-2 rounded-full bg-[#d7ff00]" />}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        {/* Sample count */}
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCinemaSamples((s) => Math.max(1, s - 1))} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white">−</button>
                          <span className="min-w-[20px] text-center text-xs font-bold text-slate-300">{cinemaSamples}</span>
                          <button type="button" onClick={() => setCinemaSamples((s) => s + 1)} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white">+</button>
                        </div>
                      </div>
                    </div>

                    {/* Generate button */}
                    <button
                      type="button"
                      disabled={!cinemaPrompt.trim() || loading}
                      onClick={() => {
                        if (cinemaInputMode === 'Video') {
                          void runCinemaVideoGeneration();
                        } else {
                          setPrompt(cinemaPrompt);
                          setMainTab('Создать видео');
                          setTimeout(() => { void runGeneration(); }, 100);
                        }
                      }}
                      className="flex min-w-[100px] flex-col items-center justify-center gap-1 rounded-xl bg-[#d7ff00] px-4 py-3 text-xs font-black uppercase text-black transition hover:bg-[#e2ff4d] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {loading && cinemaInputMode === 'Video' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <span className="text-sm tracking-widest">GENERATE</span>
                          <span className="opacity-60">→ 0.125</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : mainTab === 'CapCut' ? (
            <section className="relative overflow-hidden rounded-[24px] bg-[#0b0d0f] lg:min-h-[720px]">
              {/* Ambient glow — red/pink accent */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff3b5c]/[0.05] blur-[120px]" />
              </div>

              {/* Hero area */}
              <div className="flex flex-col items-center justify-center px-6 pb-52 pt-16 text-center lg:pt-24">
                {/* Stacked video cards */}
                <div className="relative mb-10 h-48 w-72 sm:h-52 sm:w-80">
                  <div className="absolute inset-0 -rotate-6 scale-90 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/50">
                    <img src="https://picsum.photos/seed/capcut1/640/360" alt="" className="h-full w-full object-cover opacity-60" />
                  </div>
                  <div className="absolute inset-0 rotate-3 scale-95 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1c1f] shadow-2xl shadow-black/50">
                    <img src="https://picsum.photos/seed/capcut2/640/360" alt="" className="h-full w-full object-cover opacity-75" />
                  </div>
                  <div className="absolute inset-0 overflow-hidden rounded-2xl border border-white/15 bg-[#1a1c1f] shadow-2xl shadow-black/70">
                    <img src="https://picsum.photos/seed/capcut3/640/360" alt="" className="h-full w-full object-cover" />
                  </div>
                </div>

                {/* Headline */}
                <h2 className="max-w-2xl text-4xl font-black uppercase leading-[0.92] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Редактируй видео.{' '}
                  <span className="text-[#ff3b5c]">Без ограничений.</span>
                </h2>
              </div>

              {/* Bottom input bar */}
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-6 sm:px-8">
                <div className="mx-auto max-w-3xl">
                  <div className="flex items-stretch gap-3 rounded-2xl border border-white/10 bg-[#141618] p-2 shadow-2xl shadow-black/60 backdrop-blur-xl">

                    {/* Image / Video toggle */}
                    <div className="flex flex-col gap-1">
                      {(['Image', 'Video'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCapCutInputMode(mode)}
                          className={`flex h-10 w-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold transition ${capCutInputMode === mode ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          {mode === 'Image' ? <ImageIcon className="h-4 w-4" /> : <FileVideo className="h-4 w-4" />}
                          {mode}
                        </button>
                      ))}
                    </div>

                    {/* Prompt */}
                    <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
                      <input
                        type="text"
                        value={capCutPrompt}
                        onChange={(e) => setCapCutPrompt(e.target.value)}
                        placeholder="Опишите что нужно сделать с видео..."
                        className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-400">✂️ Обрезка</span>
                        <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-400">🎵 Музыка</span>
                        <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-400">🔀 Склейка</span>
                        <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-400">✨ Эффекты</span>
                      </div>
                    </div>

                    {/* Edit button */}
                    <button
                      type="button"
                      disabled={!capCutPrompt.trim()}
                      className="flex min-w-[100px] flex-col items-center justify-center gap-1 rounded-xl bg-[#ff3b5c] px-4 py-3 text-xs font-black uppercase text-white transition hover:bg-[#ff5c75] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="text-sm tracking-widest">EDIT</span>
                      <span className="opacity-60">→ скоро</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : mainTab === 'История' ? (
            <section className="rounded-[24px] border border-white/8 bg-[#141719] p-5 shadow-2xl shadow-black/30 lg:min-h-[720px] lg:p-8">
              <h2 className="text-2xl font-black text-white">История генераций</h2>
              {generations.length === 0 ? (
                <div className="mt-12 flex flex-col items-center justify-center gap-3 text-center text-slate-400">
                  <Folder className="h-12 w-12 opacity-30" />
                  <p className="text-sm">Генераций пока нет. Создайте первое видео!</p>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {generations.map((gen) => (
                    <article key={gen.id} className="grid gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 sm:grid-cols-[100px_1fr_auto] sm:items-center">
                      <div className="overflow-hidden rounded-xl bg-black">
                        {gen.resultVideoUrl ? (
                          <video src={gen.resultVideoUrl} className="aspect-square w-full object-cover" muted playsInline />
                        ) : (
                          <div className="flex aspect-square items-center justify-center text-[10px] font-bold text-slate-500 uppercase">{gen.status}</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm leading-6 text-slate-200">{gen.prompt}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                          <span className={`rounded-full px-2 py-0.5 font-bold ${gen.status === 'completed' ? 'bg-emerald-400/15 text-emerald-300' : gen.status === 'failed' ? 'bg-rose-400/15 text-rose-300' : 'bg-blue-400/15 text-blue-300'}`}>{gen.status}</span>
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{gen.aspectRatio}</span>
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{gen.duration}с</span>
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{gen.createdAt.toDate().toLocaleDateString('ru')}</span>
                          {gen.saved ? <span className="rounded-full bg-pink-400/15 px-2 py-0.5 text-pink-300">♥ Сохранено</span> : null}
                        </div>
                        {gen.status === 'failed' && gen.errorMessage ? (
                          <p className="mt-1 line-clamp-2 text-[11px] text-rose-400/80">{gen.errorMessage}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        {gen.resultVideoUrl ? (
                          <a href={gen.resultVideoUrl} download className="flex min-h-9 items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 text-xs font-bold text-slate-200 hover:bg-white/[0.12]">
                            Скачать
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setPrompt(gen.prompt);
                            setAspectRatio(gen.aspectRatio);
                            setDuration(gen.duration);
                            setCurrentGeneration(gen);
                            setMainTab('Создать видео');
                          }}
                          className="flex min-h-9 items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 text-xs font-bold text-slate-200 hover:bg-white/[0.12]"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          Открыть
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : mainTab === 'Как это работает' ? (
            <section className="rounded-[24px] border border-white/8 bg-[#141719] px-5 py-12 shadow-2xl shadow-black/30 md:px-8 lg:min-h-[720px] lg:px-10 lg:py-20">
              <div className="max-w-6xl">
                <h2 className="max-w-5xl text-4xl font-black uppercase leading-[0.95] tracking-tight text-white md:text-5xl lg:text-6xl">
                  Создавайте видео одним щелчком мыши.
                </h2>
                <p className="mt-5 max-w-5xl text-sm leading-6 text-slate-400">
                  Более <span className="rounded bg-blue-500 px-1 text-white">250 пресетов для управления камерой и кадрированием</span>, а также качественные визуальные эффекты.
                </p>
              </div>
              <div className="mt-10 grid gap-8 xl:grid-cols-3">
                <StepCard image="https://picsum.photos/seed/step1/900/675" title="Добавьте изображение" description="Загрузите изображение, видео или аудио, чтобы задать стиль, персонажа или стартовый кадр." />
                <StepCard image="https://picsum.photos/seed/step2/900/675" title="Выберите пресет" description="Выберите формат и длительность в левой панели, затем опишите, что должно произойти в кадре." />
                <StepCard image="https://picsum.photos/seed/step3/900/675" title="Получите видео" description="Нажмите «Сгенерировать», чтобы создать финальный ролик через Seedance 2.0." />
              </div>
            </section>
          ) : (
          <section className="rounded-[24px] border border-white/8 bg-[#141719] px-5 py-10 shadow-2xl shadow-black/30 md:px-8 lg:min-h-[720px] lg:px-10">
            {!currentGeneration && !loading && !error ? (
              <>
                <div className="max-w-6xl pt-8 lg:pt-14">
                  <h2 className="max-w-5xl text-4xl font-black uppercase leading-[0.95] tracking-tight text-white md:text-5xl lg:text-6xl">
                    Создавайте видео одним щелчком мыши.
                  </h2>
                  <p className="mt-5 max-w-5xl text-sm leading-6 text-slate-400">
                    Более <span className="rounded bg-blue-500 px-1 text-white">250 пресетов для управления камерой и кадрированием</span>, а также качественные визуальные эффекты. Опишите сцену и нажмите «Сгенерировать».
                  </p>
                </div>
                <div className="mt-10 grid gap-8 xl:grid-cols-3">
                  <StepCard image="https://picsum.photos/seed/step1/900/675" title="Добавьте изображение" description="Загрузите изображение, видео или аудио, чтобы задать стиль, персонажа или стартовый кадр." />
                  <StepCard image="https://picsum.photos/seed/step2/900/675" title="Выберите пресет" description="Выберите формат и длительность в левой панели, затем опишите, что должно произойти в кадре." />
                  <StepCard image="https://picsum.photos/seed/step3/900/675" title="Получите видео" description="Нажмите «Сгенерировать», чтобы создать финальный ролик через Seedance 2.0." />
                </div>
              </>
            ) : null}
            <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                {(loading || error || currentGeneration) ? (
                  error ? (
                    <GenerationStatus status="failed" error={error} modelName={videoModels.find((m) => m.id === modelId)?.name} />
                  ) : (
                    <GenerationStatus
                      status={loading ? 'processing' : currentGeneration?.status}
                      error={currentGeneration?.status === 'failed' ? currentGeneration?.errorMessage : undefined}
                      modelName={videoModels.find((m) => m.id === (currentGeneration?.modelId ?? modelId))?.name}
                    />
                  )
                ) : null}
                {notice ? <p className="mt-3 rounded-xl border border-lime-300/20 bg-lime-300/10 p-3 text-sm font-bold text-lime-100">{notice}</p> : null}
              </div>
              <div ref={resultRef}>
                <VideoResult
                  generation={currentGeneration}
                  onCopyPrompt={copyPrompt}
                  onRegenerate={() => {
                    void runGeneration();
                  }}
                  onSave={() => void saveToGallery()}
                />
              </div>
            </div>
          </section>
          )}
        </section>
      </form>

      {mediaPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm" onClick={() => { setMediaPickerOpen(false); setNewElementOpen(false); }}>
          <section
            className="w-full max-w-[760px] overflow-hidden rounded-[24px] border border-white/10 bg-[#202223] shadow-2xl shadow-black/60"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[#151719] p-2">
              <div className="flex min-w-0 gap-1 overflow-x-auto text-xs font-bold text-slate-200">
                {['Загрузки', 'Генерация изображений', 'Видеопоколения', 'Элементы', 'Понравилось'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => { setMediaPickerTab(tab); setNewElementOpen(false); }}
                    className={`shrink-0 rounded-full px-4 py-2 ${mediaPickerTab === tab ? 'bg-white text-black' : 'text-slate-200 hover:bg-white/10 hover:text-white'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setMediaPickerOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/8 text-slate-300 hover:bg-white/12 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-[360px] p-3 sm:min-h-[430px]">
              {mediaPickerTab === 'Элементы' ? (
                <div>
                  {newElementOpen ? (
                    /* ── Форма добавления нового элемента ── */
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={closeNewElementForm} className="grid h-8 w-8 place-items-center rounded-full bg-white/8 text-slate-300 hover:bg-white/12 hover:text-white">
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-black text-white">Новый элемент</span>
                      </div>

                      <label className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] transition hover:bg-white/[0.07]">
                        {newElementImagePreview ? (
                          <img src={newElementImagePreview} alt="" className="h-full w-full rounded-2xl object-cover" style={{ maxHeight: 200 }} />
                        ) : (
                          <>
                            <span className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200">
                              <ImageIcon className="h-6 w-6" />
                            </span>
                            <span className="text-sm font-bold text-slate-300">Загрузить фото элемента</span>
                            <span className="text-[11px] text-slate-500">JPG, PNG, WEBP</span>
                          </>
                        )}
                        <input type="file" accept="image/*" className="sr-only" onChange={handleNewElementImageChange} />
                      </label>

                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-400">Название <span className="text-rose-400">*</span></label>
                        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
                          <span className="font-bold text-violet-400">@</span>
                          <input
                            type="text"
                            value={newElementName}
                            onChange={(e) => setNewElementName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveNewElement(); } }}
                            placeholder="Luna, Школа, Портфель..."
                            className="flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                          />
                          {newElementName.trim() ? (
                            <span className="shrink-0 rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                              {buildHandle(newElementName)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-400">Категория</label>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          {(['general', 'character', 'location', 'prop'] as VideoElementCategory[]).map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setNewElementCategory(cat)}
                              className={`rounded-xl py-2.5 text-xs font-bold transition ${newElementCategory === cat ? 'bg-white text-black' : 'bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]'}`}
                            >
                              {CATEGORY_LABELS[cat]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Описание для Prompt Augmentation */}
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-400">
                          Описание для AI
                          <span className="ml-1 font-normal text-slate-600">(необязательно — заменит @handle в промпте)</span>
                        </label>
                        <textarea
                          value={newElementDescription}
                          onChange={(e) => setNewElementDescription(e.target.value)}
                          placeholder={
                            newElementCategory === 'character'
                              ? 'Пример: young curly-haired girl in orange hoodie, big brown eyes'
                              : newElementCategory === 'location'
                              ? 'Пример: modern red brick school building with glass entrance'
                              : newElementCategory === 'prop'
                              ? 'Пример: bright pink school backpack with star patches'
                              : 'Опишите элемент для AI генерации...'
                          }
                          rows={2}
                          className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs leading-5 text-white outline-none placeholder:text-slate-600"
                        />
                        <p className="mt-1 text-[10px] text-slate-600">
                          Если заполнено: «Девочка @Luna» → «Девочка {newElementDescription.trim() || 'описание элемента'}»
                        </p>
                      </div>

                      <div className="flex justify-end gap-2 border-t border-white/8 pt-3">
                        <button type="button" onClick={closeNewElementForm} className="rounded-xl border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-slate-200 hover:bg-white/[0.1]">
                          Отмена
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveNewElement()}
                          disabled={!newElementName.trim() || newElementSaving}
                          className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {newElementSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {newElementSaving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Галерея элементов ── */
                    <>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 gap-1 overflow-x-auto text-xs text-slate-300">
                          {([
                            { key: 'all', label: 'Все' },
                            { key: 'pinned', label: 'Закреплённые' },
                            { key: 'general', label: 'Общие' },
                            { key: 'character', label: 'Персонажи' },
                            { key: 'location', label: 'Локации' },
                            { key: 'prop', label: 'Реквизит' },
                          ] as const).map(({ key, label }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setElementCategoryFilter(key)}
                              className={`shrink-0 rounded-lg px-3 py-2 transition ${elementCategoryFilter === key ? 'bg-white/12 text-white' : 'hover:bg-white/8 hover:text-white'}`}
                            >
                              {label}
                              {key !== 'all' && key !== 'pinned' ? (
                                <span className="ml-1 text-[10px] opacity-50">
                                  {elements.filter((e) => (e.category as string) === key).length || ''}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setElementSearchOpen((v) => !v)}
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${elementSearchOpen ? 'bg-white text-black' : 'bg-white/8 text-slate-300 hover:bg-white/12'}`}
                        >
                          <Search className="h-4 w-4" />
                        </button>
                      </div>

                      {elementSearchOpen ? (
                        <div className="mb-3">
                          <input
                            type="text"
                            value={elementSearch}
                            onChange={(e) => setElementSearch(e.target.value)}
                            placeholder="Поиск по имени или @handle..."
                            className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
                            autoFocus
                          />
                        </div>
                      ) : null}

                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        <button
                          type="button"
                          onClick={openNewElementForm}
                          className="flex aspect-square flex-col items-center justify-center rounded-2xl bg-white/[0.05] p-3 text-center transition hover:bg-white/[0.08]"
                        >
                          <span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200 shadow-xl">
                            <Plus className="h-6 w-6" />
                          </span>
                          <span className="mt-4 text-xs font-bold text-white">Новый</span>
                        </button>

                        {filteredElements.map((element) => (
                          <div key={element.id} className="group relative text-left">
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => {
                                setPrompt((p) => `${p}${p.trim() ? ' ' : ''}${element.handle}`);
                                setNotice(`${element.handle} добавлен в промпт.`);
                                setMediaPickerOpen(false);
                              }}
                            >
                              <span className="relative block overflow-hidden rounded-xl">
                                {element.imageUrl ? (
                                  <img src={element.imageUrl} alt={element.name} className="aspect-square w-full object-cover" />
                                ) : (
                                  <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white/[0.06] text-2xl">
                                    {element.category === 'character' ? '👤' : element.category === 'location' ? '📍' : element.category === 'prop' ? '🎒' : '📁'}
                                  </div>
                                )}
                                <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/20 rounded-xl" />
                                {element.pinned ? (
                                  <span className="absolute left-1.5 top-1.5 rounded-full bg-[#d7ff00] px-1.5 py-0.5 text-[9px] font-black text-black">📌</span>
                                ) : null}
                              </span>
                              <span className="mt-1.5 block truncate text-xs font-bold text-white">{element.handle}</span>
                              <span className="block text-[10px] text-slate-500">{CATEGORY_LABELS[element.category]}</span>
                            </button>

                            {/* Кнопки управления */}
                            <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleTogglePin(element); }}
                                className="grid h-7 w-7 place-items-center rounded-full bg-black/75 text-white hover:bg-[#d7ff00] hover:text-black transition"
                                title={element.pinned ? 'Открепить' : 'Закрепить'}
                              >
                                {element.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void handleDeleteElement(element); }}
                                className="grid h-7 w-7 place-items-center rounded-full bg-black/75 text-white hover:bg-red-500 transition"
                                title="Удалить"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {filteredElements.length === 0 && elementCategoryFilter !== 'all' ? (
                          <div className="col-span-5 flex flex-col items-center justify-center py-12 text-center text-slate-500">
                            <p className="text-sm">Нет элементов в этой категории.</p>
                            <button type="button" onClick={openNewElementForm} className="mt-3 text-xs text-violet-400 hover:text-violet-300">
                              + Добавить первый
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              ) : mediaPickerTab === 'Видеопоколения' ? (
                <div>
                  {generations.filter((g) => g.status === 'completed' && g.resultVideoUrl).length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
                      <PlayCircle className="h-10 w-10 opacity-30" />
                      <p className="text-sm">Готовых видео пока нет.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {generations.filter((g) => g.status === 'completed' && g.resultVideoUrl).map((gen) => (
                        <button
                          key={gen.id}
                          type="button"
                          className="group text-left"
                          onClick={() => {
                            setCurrentGeneration(gen);
                            setPrompt(gen.prompt);
                            setMediaPickerOpen(false);
                            setMainTab('Создать видео');
                          }}
                        >
                          <span className="relative block overflow-hidden rounded-xl">
                            <video src={gen.resultVideoUrl} className="aspect-square w-full object-cover" muted playsInline />
                            <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
                          </span>
                          <span className="mt-2 block truncate text-[11px] font-bold text-slate-300">{gen.aspectRatio} · {gen.duration}с</span>
                          <span className="block truncate text-[10px] text-slate-500">{gen.createdAt.toDate().toLocaleDateString('ru')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : mediaPickerTab === 'Понравилось' ? (
                <div>
                  {generations.filter((g) => g.saved && g.resultVideoUrl).length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
                      <Heart className="h-10 w-10 opacity-30" />
                      <p className="text-sm">Нет сохранённых видео. Нажмите «Сохранить» после генерации.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {generations.filter((g) => g.saved && g.resultVideoUrl).map((gen) => (
                        <button
                          key={gen.id}
                          type="button"
                          className="group text-left"
                          onClick={() => {
                            setCurrentGeneration(gen);
                            setPrompt(gen.prompt);
                            setMediaPickerOpen(false);
                            setMainTab('Создать видео');
                          }}
                        >
                          <span className="relative block overflow-hidden rounded-xl">
                            <video src={gen.resultVideoUrl} className="aspect-square w-full object-cover" muted playsInline />
                            <span className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
                          </span>
                          <span className="mt-2 block truncate text-[11px] font-bold text-slate-300">{gen.aspectRatio} · {gen.duration}с</span>
                          <span className="block truncate text-[10px] text-slate-500">{gen.createdAt.toDate().toLocaleDateString('ru')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="col-span-2 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl bg-white/[0.06] p-4 text-center transition hover:bg-white/[0.09] sm:col-span-1">
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-4 text-sm font-bold text-white">Загрузить медиафайлы</span>
                    <span className="mt-3 rounded-lg bg-white/[0.06] px-3 py-2 text-[11px] leading-4 text-slate-400">
                      Запрещено размещать защищенный контент.
                    </span>
                    <input type="file" accept="image/*,video/*,audio/*" className="sr-only" onChange={handleReferenceUpload} />
                  </label>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
