import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { McpKeyIssuedDto } from '@video-studio/shared';
import { Check, Copy, KeyRound, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Input, Skeleton, Surface } from '@/components/ui';
import { useLanguage } from '@/i18n/LanguageContext';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

const COPIED_RESET_MS = 2000;

function formatDate(iso: string | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(locale);
}

/**
 * Issues and revokes the connector key Claude uses to reach this account.
 *
 * The key lives in the connector URL because Claude's dialog has nowhere to put a header,
 * which makes the URL itself a secret. It is therefore shown exactly once, at issue time —
 * the server keeps only a hash, so there is no way to display it again later.
 */
export function McpConnector() {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();

  /** Held in memory only for as long as this screen is open. */
  const [issued, setIssued] = useState<McpKeyIssuedDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const status = useQuery({ queryKey: qk.mcpKey, queryFn: () => api.mcp.key() });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const issue = useMutation({
    mutationFn: () => api.mcp.issueKey(),
    onSuccess: (result) => {
      setIssued(result);
      setError('');
      void queryClient.invalidateQueries({ queryKey: qk.mcpKey });
    },
    onError: (mutationError: unknown) => {
      setError(mutationError instanceof Error ? mutationError.message : t('settings.mcp.failed'));
    },
  });

  const revoke = useMutation({
    mutationFn: () => api.mcp.revokeKey(),
    onSuccess: () => {
      setIssued(null);
      setError('');
      void queryClient.invalidateQueries({ queryKey: qk.mcpKey });
    },
    onError: (mutationError: unknown) => {
      setError(mutationError instanceof Error ? mutationError.message : t('settings.mcp.failed'));
    },
  });

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError(t('settings.mcp.copyFailed'));
    }
  }

  const busy = issue.isPending || revoke.isPending;
  const hasKey = status.data?.hasKey ?? false;
  const created = formatDate(status.data?.createdAt, language);
  const lastUsed = formatDate(status.data?.lastUsedAt, language);

  const steps = [
    { title: t('settings.mcp.step1Title'), body: t('settings.mcp.step1Body') },
    { title: t('settings.mcp.step2Title'), body: t('settings.mcp.step2Body') },
    { title: t('settings.mcp.step3Title'), body: t('settings.mcp.step3Body') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('settings.mcp.title')}</h2>
        {status.data ? (
          <Badge tone={status.data.enabled ? 'success' : 'warning'}>
            {t(status.data.enabled ? 'settings.mcp.enabled' : 'settings.mcp.disabled')}
          </Badge>
        ) : null}
      </div>

      <p className="max-w-2xl text-sm text-text-muted">{t('settings.mcp.subtitle')}</p>

      {status.data && !status.data.enabled ? (
        <p className="text-sm text-warning">{t('settings.mcp.disabledHint')}</p>
      ) : null}

      {status.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : status.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-danger">{t('settings.mcp.loadFailed')}</p>
          <Button size="sm" variant="secondary" onClick={() => void status.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <>
          {issued ? (
            <Surface elevation="inset" radius="md" className="flex flex-col gap-2 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {t('settings.mcp.onceWarning')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  readOnly
                  value={issued.url}
                  aria-label={t('settings.mcp.urlLabel')}
                  className="min-w-0 flex-1 font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant={copied ? 'secondary' : 'primary'}
                  onClick={() => void copyUrl(issued.url)}
                  icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                >
                  {t(copied ? 'settings.mcp.copied' : 'settings.mcp.copy')}
                </Button>
              </div>
            </Surface>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {hasKey ? (
              <>
                <Badge tone="neutral" sunken>
                  <KeyRound className="size-3.5" aria-hidden />
                  {`vsmcp_…${status.data.hint ?? ''}`}
                </Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={issue.isPending}
                  disabled={busy}
                  onClick={() => issue.mutate()}
                  icon={<RefreshCw className="size-4" />}
                >
                  {t('settings.mcp.rotate')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={revoke.isPending}
                  disabled={busy}
                  onClick={() => revoke.mutate()}
                  icon={<Trash2 className="size-4" />}
                >
                  {t('settings.mcp.revoke')}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-text-muted">{t('settings.mcp.noKey')}</p>
                <Button
                  size="sm"
                  variant="primary"
                  loading={issue.isPending}
                  disabled={busy}
                  onClick={() => issue.mutate()}
                  icon={<KeyRound className="size-4" />}
                >
                  {t('settings.mcp.create')}
                </Button>
              </>
            )}
          </div>

          {hasKey ? (
            <p className="text-xs text-text-subtle">
              {created ? `${t('settings.mcp.created')}: ${created}` : null}
              {created ? ' · ' : null}
              {lastUsed
                ? `${t('settings.mcp.lastUsed')}: ${lastUsed}`
                : t('settings.mcp.neverUsed')}
            </p>
          ) : null}

          {hasKey ? (
            <p className="text-xs text-text-subtle">{t('settings.mcp.rotateHint')}</p>
          ) : null}
        </>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <Surface elevation="raised-sm" radius="md" className="flex h-full flex-col gap-1 p-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-accent shadow-neu-raised-sm"
                >
                  {index + 1}
                </span>
                {step.title}
              </span>
              <span className="text-xs text-text-muted">{step.body}</span>
            </Surface>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default McpConnector;
