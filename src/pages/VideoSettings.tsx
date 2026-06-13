import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Bot, CheckCircle2, ChevronDown, Coins, Copy, Eye, EyeOff, Languages, Link, Loader2, RefreshCw, Save, Tag, XCircle } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import VideoStudioNav from '../components/video/VideoStudioNav';
import { useLanguage } from '../context/LanguageContext';
import { callWorker } from '../lib/callWorker';
import { auth } from '../firebaseAuth';
import { subscribeToCredits, getCreditHistory, type CreditLogEntry } from '../services/firebaseVideoService';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

type ClaudeSettings = {
  hasApiKey: boolean;
  mcpUrl: string | null;
};

type ClaudeTestResult = {
  status: 'ok' | 'error';
  hasApiKey: boolean;
  hasMcpUrl: boolean;
  mcpUrl?: string | null;
  model: string | null;
  message: string;
};

type SeedanceDiagnostics = {
  mockMode: boolean;
  liveTestMode: boolean;
  providerFlavor: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: 'ok' | 'error';
  message: string;
};

type ProviderStatus = {
  name: string;
  configured: boolean;
  mockMode: boolean;
  status: 'ok' | 'not_configured';
};

type AllProviderDiagnostics = {
  providers: Record<string, ProviderStatus>;
};

const MODEL_CREDIT_COST: { id: string; label: string; cost: number }[] = [
  { id: 'seedance-2', label: 'Seedance 2.0', cost: 25 },
  { id: 'seedance-2-fast', label: 'Seedance 2.0 Fast', cost: 15 },
  { id: 'replicate-kling', label: 'Kling (Replicate)', cost: 20 },
  { id: 'replicate-luma', label: 'Luma (Replicate)', cost: 15 },
  { id: 'leonardo-motion', label: 'Leonardo Motion', cost: 15 },
  { id: 'wavespeed-wan', label: 'WaveSpeed WAN', cost: 10 },
  { id: 'wavespeed-wan-i2v', label: 'WaveSpeed I2V', cost: 10 },
  { id: 'replicate-wan-t2v', label: 'WAN T2V (Replicate)', cost: 10 },
  { id: 'replicate-wan-i2v', label: 'WAN I2V (Replicate)', cost: 10 },
  { id: 'huggingface-cogvideox', label: 'CogVideoX (HF)', cost: 10 },
  { id: 'huggingface-opensora', label: 'Open-Sora (HF)', cost: 10 },
  { id: 'json2video', label: 'JSON2Video', cost: 10 },
  { id: 'cogvideox-free', label: 'CogVideoX Free', cost: 5 },
  { id: 'ltx-fast', label: 'LTX Fast', cost: 5 },
  { id: 'svd', label: 'Stable Video Diffusion', cost: 5 },
];

const PROVIDER_DESCRIPTIONS: Record<string, { label: string; envKey: string; url: string; color: string }> = {
  seedance: { label: 'Seedance 2.0', envKey: 'SEEDANCE_API_KEY', url: 'seedance2.app', color: 'violet' },
  replicate: { label: 'Replicate', envKey: 'REPLICATE_API_TOKEN', url: 'replicate.com', color: 'blue' },
  wavespeed: { label: 'WaveSpeed', envKey: 'WAVESPEED_API_KEY', url: 'wavespeed.ai', color: 'cyan' },
  huggingface: { label: 'HuggingFace', envKey: 'HUGGINGFACE_API_TOKEN', url: 'huggingface.co', color: 'yellow' },
  leonardo: { label: 'Leonardo AI', envKey: 'LEONARDO_API_KEY', url: 'leonardo.ai', color: 'orange' },
  json2video: { label: 'JSON2Video', envKey: 'JSON2VIDEO_API_KEY', url: 'json2video.com', color: 'green' },
};

function ProviderBlock({ providerId, status }: { providerId: string; status: ProviderStatus }) {
  const meta = PROVIDER_DESCRIPTIONS[providerId];
  if (!meta) return null;

  const isOk = status.configured || status.mockMode;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-white">{meta.label}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{meta.envKey}</p>
        </div>
        {isOk
          ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          : <XCircle className="h-5 w-5 shrink-0 text-rose-400" />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-black/30 p-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">API Key</p>
          <p className={`mt-1 text-xs font-bold ${status.configured ? 'text-emerald-300' : 'text-rose-300'}`}>
            {status.configured ? 'Настроен' : 'Не задан'}
          </p>
        </div>
        <div className="rounded-lg bg-black/30 p-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Mock</p>
          <p className={`mt-1 text-xs font-bold ${status.mockMode ? 'text-amber-300' : 'text-slate-300'}`}>
            {status.mockMode ? 'Активен' : 'Выключен'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function VideoSettings() {
  const { currentLanguage, setCurrentLanguage } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [seedanceDiagnostics, setSeedanceDiagnostics] = useState<SeedanceDiagnostics | null>(null);
  const [allDiagnostics, setAllDiagnostics] = useState<AllProviderDiagnostics | null>(null);
  const [testingSeedance, setTestingSeedance] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [seedanceError, setSeedanceError] = useState('');
  const [allError, setAllError] = useState('');

  // Claude / MCP state
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeMcpUrl, setClaudeMcpUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [claudeSettings, setClaudeSettings] = useState<ClaudeSettings | null>(null);
  const [claudeTestResult, setClaudeTestResult] = useState<ClaudeTestResult | null>(null);
  const [savingClaude, setSavingClaude] = useState(false);
  const [testingClaude, setTestingClaude] = useState(false);
  const [claudeSaveError, setClaudeSaveError] = useState('');
  const [claudeSaveSuccess, setClaudeSaveSuccess] = useState(false);
  // MCP URL state
  const [mcpServerUrl, setMcpServerUrl] = useState<string | null>(null);
  const [generatingMcpToken, setGeneratingMcpToken] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [mcpGenerateError, setMcpGenerateError] = useState<string | null>(null);

  // Credits state
  const [credits, setCredits] = useState<number | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [redeemingPromo, setRedeemingPromo] = useState(false);
  const [promoMessage, setPromoMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCostTable, setShowCostTable] = useState(false);
  // Credit history
  const [creditHistory, setCreditHistory] = useState<CreditLogEntry[]>([]);
  const [historyLastDoc, setHistoryLastDoc] = useState<QueryDocumentSnapshot | undefined>(undefined);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    return subscribeToCredits(user.uid, setCredits, () => {});
  }, [user]);

  const loadHistory = useCallback(async (afterDoc?: QueryDocumentSnapshot) => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const { entries, lastDoc } = await getCreditHistory(user.uid, 10, afterDoc);
      setCreditHistory((prev) => afterDoc ? [...prev, ...entries] : entries);
      setHistoryLastDoc(lastDoc ?? undefined);
      setHistoryHasMore(entries.length === 10);
    } catch {
      // silently fail
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    callWorker<ClaudeSettings>('getClaudeSettings').then((data) => {
      setClaudeSettings(data);
      if (data.mcpUrl) setClaudeMcpUrl(data.mcpUrl);
    }).catch(() => {});

    callWorker<{ mcpUrl: string | null }>('getMcpToken').then((data) => {
      if (data.mcpUrl) setMcpServerUrl(data.mcpUrl);
    }).catch(() => {});
  }, [user]);

  async function redeemPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    setRedeemingPromo(true);
    setPromoMessage(null);
    try {
      const res = await callWorker<{ success: boolean; creditsGranted: number; message: string }>('redeemPromoCode', { code });
      setPromoMessage({ ok: true, text: res.message });
      setPromoCode('');
    } catch (err) {
      setPromoMessage({ ok: false, text: err instanceof Error ? err.message : 'Ошибка активации промокода.' });
    } finally {
      setRedeemingPromo(false);
    }
  }

  async function generateMcpToken() {
    setGeneratingMcpToken(true);
    setMcpGenerateError(null);
    try {
      const res = await callWorker<{ mcpUrl: string }>('generateMcpToken');
      setMcpServerUrl(res.mcpUrl);
    } catch (err) {
      setMcpGenerateError(err instanceof Error ? err.message : 'Ошибка генерации URL. Попробуйте позже.');
    } finally {
      setGeneratingMcpToken(false);
    }
  }

  function copyMcpUrl() {
    if (!mcpServerUrl) return;
    void navigator.clipboard.writeText(mcpServerUrl);
    setMcpCopied(true);
    setTimeout(() => setMcpCopied(false), 2000);
  }

  async function saveClaudeSettings() {
    if (!claudeApiKey && !claudeMcpUrl) {
      setClaudeSaveError('Введите API-ключ или MCP URL.');
      return;
    }
    setSavingClaude(true);
    setClaudeSaveError('');
    setClaudeSaveSuccess(false);
    try {
      await callWorker('saveClaudeSettings', { apiKey: claudeApiKey, mcpUrl: claudeMcpUrl });
      setClaudeSaveSuccess(true);
      setClaudeApiKey('');
      const updated = await callWorker<ClaudeSettings>('getClaudeSettings');
      setClaudeSettings(updated);
    } catch (err) {
      setClaudeSaveError(err instanceof Error ? err.message : 'Ошибка сохранения настроек.');
    } finally {
      setSavingClaude(false);
    }
  }

  async function testClaudeConnection() {
    setTestingClaude(true);
    setClaudeTestResult(null);
    try {
      const result = await callWorker<ClaudeTestResult>('testClaudeConnection');
      setClaudeTestResult(result);
    } catch (err) {
      setClaudeTestResult({
        status: 'error',
        hasApiKey: false,
        hasMcpUrl: false,
        model: null,
        message: err instanceof Error ? err.message : 'Не удалось проверить подключение.',
      });
    } finally {
      setTestingClaude(false);
    }
  }

  async function testSeedanceConnection() {
    setTestingSeedance(true);
    setSeedanceError('');
    try {
      const result = await callWorker<SeedanceDiagnostics>('testSeedanceConnection');
      setSeedanceDiagnostics(result);
    } catch (err) {
      setSeedanceDiagnostics(null);
      setSeedanceError(err instanceof Error ? err.message : 'Failed to test Seedance connection.');
    } finally {
      setTestingSeedance(false);
    }
  }

  async function testAllProviders() {
    setTestingAll(true);
    setAllError('');
    try {
      const result = await callWorker<AllProviderDiagnostics>('testProviderConnection');
      setAllDiagnostics(result);
    } catch (err) {
      setAllDiagnostics(null);
      setAllError(err instanceof Error ? err.message : 'Failed to fetch provider statuses.');
    } finally {
      setTestingAll(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <div className="w-full px-4 py-5 sm:px-6 lg:px-8 2xl:px-10">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">PingTop AI</p>
            <h1 className="mt-2 text-3xl font-black">Settings</h1>
          </div>
          <VideoStudioNav />
        </header>

        {/* Language */}
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-100">
                <Languages className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-black">Language settings</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Choose the site language. Russian is saved as your default on this device.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <LanguageSwitcher value={currentLanguage} onChange={setCurrentLanguage} variant="dark" />
              <button
                type="button"
                onClick={() => setCurrentLanguage('ru')}
                className="min-h-11 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-extrabold text-white transition hover:bg-white/[0.1]"
              >
                Перевести сайт на русский
              </button>
            </div>
          </div>
        </section>

        {/* Credits */}
        <section className="mt-5 rounded-lg border border-[#d7ff00]/20 bg-[#d7ff00]/[0.03] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d7ff00]/15 text-[#d7ff00]">
              <Coins className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black">Кредиты</h2>
              <p className="mt-1 text-sm text-slate-400">Баланс обновляется в реальном времени. 100 кредитов выдаётся при первой генерации.</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-3xl font-black text-[#d7ff00]">
                {credits === null ? '—' : credits}
              </p>
              <p className="text-xs text-slate-500">кредитов</p>
            </div>
          </div>

          {/* Стоимость по моделям */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowCostTable((v) => !v)}
              className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition ${showCostTable ? 'rotate-180' : ''}`} />
              Стоимость по моделям
            </button>
            {showCostTable ? (
              <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {MODEL_CREDIT_COST.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                    <span className="truncate text-xs text-slate-300">{m.label}</span>
                    <span className="ml-2 shrink-0 text-xs font-black text-[#d7ff00]">{m.cost}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Промокод */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">Промокод</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoMessage(null); }}
                  placeholder="PROMO2025"
                  maxLength={64}
                  className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-10 pr-4 text-sm font-bold text-white placeholder-slate-600 outline-none focus:border-[#d7ff00]/40 focus:ring-1 focus:ring-[#d7ff00]/20"
                />
              </div>
              <button
                type="button"
                onClick={() => void redeemPromo()}
                disabled={redeemingPromo || !promoCode.trim()}
                className="flex items-center gap-2 rounded-lg bg-[#d7ff00] px-5 py-2.5 text-sm font-extrabold text-black transition hover:bg-[#e5ff33] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {redeemingPromo ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {redeemingPromo ? 'Активация…' : 'Активировать'}
              </button>
            </div>
            {promoMessage ? (
              <p className={`mt-2 flex items-center gap-1.5 text-sm font-bold ${promoMessage.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                {promoMessage.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {promoMessage.text}
              </p>
            ) : null}
          </div>
        </section>

        {/* Credit history */}
        <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">История кредитов</h2>
              <p className="mt-1 text-sm text-slate-400">Все начисления и списания кредитов.</p>
            </div>
            {creditHistory.length === 0 ? (
              <button
                type="button"
                onClick={() => void loadHistory()}
                disabled={historyLoading}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/[0.1] disabled:opacity-50"
              >
                {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Загрузить историю
              </button>
            ) : null}
          </div>

          {creditHistory.length > 0 ? (
            <div className="mt-4">
              <div className="overflow-hidden rounded-xl border border-white/8">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/[0.03]">
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Дата</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Тип</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">Описание</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Сумма</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Баланс</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditHistory.map((entry) => (
                      <tr key={entry.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {entry.createdAt?.toDate().toLocaleDateString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            entry.type === 'deduction' ? 'bg-rose-400/15 text-rose-300' :
                            entry.type === 'signup' ? 'bg-blue-400/15 text-blue-300' :
                            entry.type === 'promo' ? 'bg-violet-400/15 text-violet-300' :
                            'bg-emerald-400/15 text-emerald-300'
                          }`}>
                            {entry.type === 'deduction' ? 'Списание' : entry.type === 'signup' ? 'Старт' : entry.type === 'promo' ? 'Промокод' : 'Начисление'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 max-w-[180px] truncate">{entry.description}</td>
                        <td className={`px-4 py-2.5 text-right text-sm font-black ${entry.amount < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {entry.amount > 0 ? '+' : ''}{entry.amount}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-white">{entry.balanceAfter}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historyHasMore ? (
                <button
                  type="button"
                  onClick={() => void loadHistory(historyLastDoc)}
                  disabled={historyLoading}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-xs font-bold text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Загрузить ещё
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* All providers status */}
        <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black">AI Video Providers</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Статусы всех подключённых AI провайдеров. API ключи никогда не возвращаются в браузер.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void testAllProviders()}
              disabled={testingAll}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testingAll ? 'Проверяем...' : 'Проверить все провайдеры'}
            </button>
          </div>

          {allError ? (
            <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-sm font-bold text-rose-100">{allError}</p>
          ) : null}

          {allDiagnostics ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(allDiagnostics.providers).map(([id, status]) => (
                <ProviderBlock key={id} providerId={id} status={status} />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(PROVIDER_DESCRIPTIONS).map((id) => (
                <ProviderBlock
                  key={id}
                  providerId={id}
                  status={{ name: id, configured: false, mockMode: false, status: 'not_configured' }}
                />
              ))}
            </div>
          )}

          <p className="mt-3 text-xs text-slate-600">
            Чтобы добавить ключ — внесите его в <code className="text-slate-500">functions/.env</code> и задеплойте функции.
          </p>
        </section>

        {/* Seedance detailed diagnostics */}
        <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black">Seedance API Diagnostics</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Детальная проверка Seedance. API ключ никогда не показывается в браузере.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void testSeedanceConnection()}
              disabled={testingSeedance}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testingSeedance ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testingSeedance ? 'Testing...' : 'Test Seedance Connection'}
            </button>
          </div>

          {seedanceError ? (
            <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-sm font-bold text-rose-100">{seedanceError}</p>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Mock mode</p>
              <p className="mt-2 text-sm font-black text-white">
                {seedanceDiagnostics ? (seedanceDiagnostics.mockMode ? 'active' : 'inactive') : 'not tested'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Live test mode</p>
              <p className="mt-2 text-sm font-black text-white">
                {seedanceDiagnostics ? (seedanceDiagnostics.liveTestMode ? 'active' : 'inactive') : 'not tested'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Provider flavor</p>
              <p className="mt-2 break-all text-sm font-black text-white">{seedanceDiagnostics?.providerFlavor || 'not tested'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">API key</p>
              <p className="mt-2 text-sm font-black text-white">
                {seedanceDiagnostics ? (seedanceDiagnostics.hasApiKey ? 'configured' : 'not configured') : 'not tested'}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Base URL</p>
              <p className="mt-2 break-all text-sm font-black text-white">{seedanceDiagnostics?.baseUrl || 'not tested'}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Status</p>
              <p className={`mt-2 text-sm font-black ${seedanceDiagnostics?.status === 'error' ? 'text-rose-200' : 'text-emerald-200'}`}>
                {seedanceDiagnostics?.status || 'not tested'}
              </p>
            </div>
          </div>

          {seedanceDiagnostics?.message ? (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-slate-200">{seedanceDiagnostics.message}</p>
          ) : null}
        </section>

        {/* MCP Server URL — главный блок */}
        <section className="mt-5 rounded-lg border border-violet-500/30 bg-violet-500/5 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <Link className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black">MCP Server URL</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Сгенерируй уникальный URL и добавь его в Claude → Settings → MCP Servers.
                После этого Claude сможет генерировать видео прямо из чата — как Higgsfield.
              </p>
            </div>
          </div>

          <div className="mt-5">
            {mcpServerUrl ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-violet-500/40 bg-black/40 px-4 py-3">
                  <code className="flex-1 truncate text-sm font-mono text-violet-200">{mcpServerUrl}</code>
                  <button
                    type="button"
                    onClick={copyMcpUrl}
                    className="shrink-0 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-violet-500"
                  >
                    {mcpCopied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Скопируй URL → открой <span className="font-bold text-white">claude.ai</span> → Settings → Integrations → Add MCP Server → вставь URL
                </p>
                <button
                  type="button"
                  onClick={() => void generateMcpToken()}
                  disabled={generatingMcpToken}
                  className="flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/[0.1] disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${generatingMcpToken ? 'animate-spin' : ''}`} />
                  Перегенерировать токен
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void generateMcpToken()}
                  disabled={generatingMcpToken}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-sm font-extrabold text-white transition hover:bg-violet-500 disabled:opacity-50"
                >
                  {generatingMcpToken
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Генерация…</>
                    : <><Link className="h-4 w-4" /> Сгенерировать MCP URL</>}
                </button>
                {mcpGenerateError && (
                  <p className="text-xs text-red-400">{mcpGenerateError}</p>
                )}
              </div>
            )}
          </div>

          {/* Инструкция */}
          <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Как подключить к Claude</p>
            <ol className="flex flex-col gap-2 text-sm text-slate-300">
              <li><span className="mr-2 font-bold text-white">1.</span>Нажми «Сгенерировать MCP URL» и скопируй URL</li>
              <li><span className="mr-2 font-bold text-white">2.</span>Открой <span className="font-bold text-white">claude.ai</span> → нажми на свой аватар → <span className="font-bold text-white">Settings</span></li>
              <li><span className="mr-2 font-bold text-white">3.</span>Перейди в раздел <span className="font-bold text-white">Integrations</span> → <span className="font-bold text-white">Add MCP Server</span></li>
              <li><span className="mr-2 font-bold text-white">4.</span>Вставь скопированный URL → сохрани</li>
              <li><span className="mr-2 font-bold text-white">5.</span>В новом чате Claude увидит инструменты: <span className="font-mono text-violet-300">generate_video</span>, <span className="font-mono text-violet-300">get_video_status</span>, <span className="font-mono text-violet-300">list_videos</span></li>
            </ol>
          </div>
        </section>

        {/* Claude / MCP */}
        <section className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-black">Claude AI / MCP</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Подключите Claude через API-ключ Anthropic. MCP URL используется как идентификатор точки подключения.
                API-ключ хранится только на сервере и никогда не передаётся в браузер.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {/* API Key */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Anthropic API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={claudeApiKey}
                  onChange={(e) => { setClaudeApiKey(e.target.value); setClaudeSaveSuccess(false); }}
                  placeholder={claudeSettings?.hasApiKey ? '••••••••  (уже сохранён)' : 'sk-ant-api03-…'}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 pr-11 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {claudeSettings?.hasApiKey && (
                <p className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> API-ключ сохранён
                </p>
              )}
            </div>

            {/* MCP URL */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                MCP Server URL
              </label>
              <div className="relative">
                <Link className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="url"
                  value={claudeMcpUrl}
                  onChange={(e) => { setClaudeMcpUrl(e.target.value); setClaudeSaveSuccess(false); }}
                  placeholder="https://your-mcp-server.example.com"
                  className="w-full rounded-lg border border-white/10 bg-black/30 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                />
              </div>
              {claudeSettings?.mcpUrl && (
                <p className="truncate text-xs text-slate-400">{claudeSettings.mcpUrl}</p>
              )}
            </div>
          </div>

          {/* Errors / success */}
          {claudeSaveError && (
            <p className="mt-3 flex items-center gap-2 text-sm text-rose-300">
              <XCircle className="h-4 w-4 shrink-0" /> {claudeSaveError}
            </p>
          )}
          {claudeSaveSuccess && (
            <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Настройки Claude сохранены.
            </p>
          )}

          {/* Buttons */}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void saveClaudeSettings()}
              disabled={savingClaude || (!claudeApiKey && !claudeMcpUrl)}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingClaude ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingClaude ? 'Сохранение…' : 'Сохранить'}
            </button>

            <button
              type="button"
              onClick={() => void testClaudeConnection()}
              disabled={testingClaude}
              className="flex min-h-10 items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-5 py-2.5 text-sm font-extrabold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testingClaude ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {testingClaude ? 'Проверка…' : 'Проверить подключение'}
            </button>
          </div>

          {/* Test result */}
          {claudeTestResult && (
            <div className={`mt-4 rounded-lg border p-4 ${claudeTestResult.status === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
              <div className="flex items-center gap-2">
                {claudeTestResult.status === 'ok'
                  ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  : <XCircle className="h-5 w-5 shrink-0 text-rose-400" />}
                <p className={`font-bold ${claudeTestResult.status === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {claudeTestResult.status === 'ok' ? 'Подключено' : 'Ошибка подключения'}
                </p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">{claudeTestResult.message}</p>
              {claudeTestResult.model && (
                <p className="mt-2 text-xs text-slate-400">Модель: <span className="font-bold text-white">{claudeTestResult.model}</span></p>
              )}
              {claudeTestResult.mcpUrl && (
                <p className="mt-1 truncate text-xs text-slate-400">MCP URL: <span className="font-bold text-white">{claudeTestResult.mcpUrl}</span></p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-black/20 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">API Key</p>
                  <p className={`mt-1 text-xs font-bold ${claudeTestResult.hasApiKey ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {claudeTestResult.hasApiKey ? 'Сохранён' : 'Не найден'}
                  </p>
                </div>
                <div className="rounded-lg bg-black/20 p-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">MCP URL</p>
                  <p className={`mt-1 text-xs font-bold ${claudeTestResult.hasMcpUrl ? 'text-emerald-300' : 'text-slate-400'}`}>
                    {claudeTestResult.hasMcpUrl ? 'Задан' : 'Не задан'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
