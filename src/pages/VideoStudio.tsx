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
  ImageIcon,
  Loader2,
  Maximize2,
  Pin,
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
  const [cinemaInputMode, setCinemaInputMode] = useState<'Image' | 'Video'>('Image');
  const [cinemaPrompt, setCinemaPrompt] = useState('');
  const [cinemaAspect, setCinemaAspect] = useState('16:9');
  const [cinemaQuality, setCinemaQuality] = useState('2K');
  const [cinemaSamples, setCinemaSamples] = useState(1);
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
                <div className="flex flex-col gap-4 p-4 pb-[140px] lg:p-6 lg:pb-[140px]">
                  {/* Preview canvas */}
                  <div className="flex min-h-[260px] flex-1 items-center justify-center rounded-2xl border border-white/8 bg-[#141618] lg:min-h-[320px]">
                    <div className="flex flex-col items-center gap-3 text-slate-600">
                      <FileVideo className="h-10 w-10" />
                      <span className="text-xs font-bold">Preview</span>
                    </div>
                  </div>

                  {/* 4 × 2 clip grid */}
                  <div className="grid grid-cols-4 gap-2 sm:gap-3">
                    {(['1:1', '1:2', '2:1', '2:2', '3:1', '3:2', '4:1', '4:2'] as const).map((label) => (
                      <div key={label} className="flex flex-col gap-1.5">
                        <div className="flex aspect-video items-center justify-center rounded-xl border border-white/8 bg-[#141618]">
                          <FileVideo className="h-5 w-5 text-white/15" />
                        </div>
                        <p className="text-center text-[10px] font-bold text-slate-500">{label}</p>
                        <button
                          type="button"
                          className="flex w-full items-center justify-center rounded-lg border border-white/8 bg-white/[0.04] py-1 transition hover:bg-white/[0.08]"
                        >
                          <Plus className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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
                          onClick={() => setCinemaInputMode(mode)}
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
                        {/* Preset chip */}
                        <button type="button" className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-bold text-slate-300 hover:bg-white/10">
                          <span>🎬</span> Soul Cinema
                        </button>
                        {/* Aspect ratio */}
                        {(['16:9', '9:16', '1:1'] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setCinemaAspect(r)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${cinemaAspect === r ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-slate-500 hover:text-slate-300'}`}
                          >
                            {r}
                          </button>
                        ))}
                        {/* Quality */}
                        {(['1K', '2K', '4K'] as const).map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => setCinemaQuality(q)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${cinemaQuality === q ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-slate-500 hover:text-slate-300'}`}
                          >
                            {q}
                          </button>
                        ))}
                        {/* Sample count */}
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => setCinemaSamples((s) => Math.max(1, s - 1))} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white">−</button>
                          <span className="min-w-[20px] text-center text-xs font-bold text-slate-300">{cinemaSamples}/4</span>
                          <button type="button" onClick={() => setCinemaSamples((s) => Math.min(4, s + 1))} className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-white">+</button>
                        </div>
                      </div>
                    </div>

                    {/* Generate button */}
                    <button
                      type="button"
                      disabled={!cinemaPrompt.trim()}
                      onClick={() => {
                        setPrompt(cinemaPrompt);
                        setMainTab('Создать видео');
                        setTimeout(() => { void runGeneration(); }, 100);
                      }}
                      className="flex min-w-[100px] flex-col items-center justify-center gap-1 rounded-xl bg-[#d7ff00] px-4 py-3 text-xs font-black uppercase text-black transition hover:bg-[#e2ff4d] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="text-sm tracking-widest">GENERATE</span>
                      <span className="opacity-60">→ 0.125</span>
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
