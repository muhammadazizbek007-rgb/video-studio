import { useRef, useEffect, useState, useMemo, type KeyboardEvent } from 'react';
import { WandSparkles } from 'lucide-react';
import { CATEGORY_LABELS } from '../../services/videoElementsService';
import type { VideoElement } from '../../types/videoElement';

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  elements: VideoElement[];
  onEnhance: () => void;
  placeholder?: string;
  maxLength?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isChip(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).getAttribute('contenteditable') === 'false';
}

/** Walk DOM and build plain text (chips → their @handle) */
function getPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (isChip(node)) return (node as Element).getAttribute('data-handle') ?? '';
  let t = '';
  node.childNodes.forEach((ch) => { t += getPlainText(ch); });
  return t;
}

/** Build HTML from plain text, turning matched @handles into chips */
function buildHTML(text: string, handleMap: Map<string, VideoElement>): string {
  if (!text) return '';
  const parts: string[] = [];
  const re = /@[\wа-яёА-ЯЁ]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(esc(text.slice(last, m.index)));
    const el = handleMap.get(m[0].toLowerCase());
    if (el) {
      const img = el.imageUrl
        ? `<img src="${esc(el.imageUrl)}" style="width:18px;height:18px;border-radius:4px;object-fit:cover;vertical-align:middle;margin-right:3px" />`
        : '';
      parts.push(
        `<span data-handle="${esc(m[0])}" contenteditable="false"` +
        ` style="display:inline-flex;align-items:center;background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.3);` +
        `border-radius:8px;padding:1px 8px 1px 4px;margin:0 2px;cursor:default;user-select:none;white-space:nowrap;vertical-align:middle">` +
        img +
        `<span style="font-size:12px;font-weight:700;color:#c4b5fd">${esc(m[0])}</span>` +
        `</span>`,
      );
    } else {
      parts.push(esc(m[0]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(esc(text.slice(last)));
  return parts.join('');
}

/**
 * Get cursor position as character index in the plain-text value.
 * Walks the DOM from root to sel.focusNode — no cloneContents, no fragment issues.
 */
function getCursorPos(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.focusNode) return 0;
  const focusNode = sel.focusNode;
  const focusOffset = sel.focusOffset;
  let pos = 0;
  let found = false;

  function walk(node: Node) {
    if (found) return;
    if (node === focusNode) {
      // For text nodes the offset is character count; for elements it's child index
      if (node.nodeType === Node.TEXT_NODE) pos += focusOffset;
      found = true;
      return;
    }
    if (isChip(node)) {
      // Count the chip as its handle text
      const len = (node as Element).getAttribute('data-handle')?.length ?? 0;
      pos += len;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      pos += node.textContent?.length ?? 0;
      return;
    }
    // Element — walk children
    let i = 0;
    for (const child of Array.from(node.childNodes)) {
      if (found) break;
      // If focusNode is this element and offset === i, we're between children
      if (node === focusNode && i === focusOffset) { found = true; break; }
      walk(child);
      i++;
    }
  }
  walk(root);
  return pos;
}

/**
 * Set cursor at plain-text position in the contenteditable DOM.
 */
function setCursorAt(root: HTMLElement, target: number) {
  const sel = window.getSelection();
  if (!sel) return;
  let pos = 0;
  let done = false;

  function walk(node: Node) {
    if (done) return;
    if (isChip(node)) {
      const len = (node as Element).getAttribute('data-handle')?.length ?? 0;
      if (pos + len >= target) {
        // Place cursor right after chip
        const range = document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        done = true;
        return;
      }
      pos += len;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (pos + len >= target) {
        const range = document.createRange();
        range.setStart(node, target - pos);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        done = true;
        return;
      }
      pos += len;
      return;
    }
    node.childNodes.forEach(walk);
  }
  walk(root);
  // Fallback — end of editor
  if (!done) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PromptEditor({
  value,
  onChange,
  elements,
  onEnhance,
  placeholder = 'Опишите сцену. Напишите @ чтобы добавить элемент.',
  maxLength = 2000,
}: PromptEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef(''); // plain text currently in DOM
  const isBusyRef = useRef(false); // suppress onInput during programmatic updates

  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(-1);
  const [isEmpty, setIsEmpty] = useState(!value);

  const handleMap = useMemo(
    () => new Map(elements.map((el) => [el.handle.toLowerCase(), el])),
    [elements],
  );

  // ── Initialize DOM on mount ──
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = buildHTML(value, handleMap);
    editor.innerHTML = html;
    internalRef.current = value;
    setIsEmpty(!value.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // ── Sync when elements load / change (re-render chips) ──
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isBusyRef.current) return;
    const text = internalRef.current;
    const newHTML = buildHTML(text, handleMap);
    if (editor.innerHTML === newHTML) return;
    const cursorPos = document.activeElement === editor ? getCursorPos(editor) : -1;
    isBusyRef.current = true;
    editor.innerHTML = newHTML;
    isBusyRef.current = false;
    if (cursorPos >= 0) setCursorAt(editor, cursorPos);
  }, [handleMap]);

  // ── Sync when value changes externally (parent changes it) ──
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isBusyRef.current) return;
    if (value === internalRef.current) return; // typed by user — already in DOM
    const cursorPos = document.activeElement === editor ? getCursorPos(editor) : -1;
    const newHTML = buildHTML(value, handleMap);
    isBusyRef.current = true;
    editor.innerHTML = newHTML;
    isBusyRef.current = false;
    internalRef.current = value;
    setIsEmpty(!value.trim());
    if (cursorPos >= 0) setCursorAt(editor, cursorPos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ── Handle user typing ──
  function handleInput() {
    if (isBusyRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;

    const text = getPlainText(editor);
    if (text.length > maxLength) {
      // Revert
      editor.innerHTML = buildHTML(internalRef.current, handleMap);
      return;
    }

    internalRef.current = text;
    setIsEmpty(!text.trim());

    // Detect @mention being typed
    try {
      const cursor = getCursorPos(editor);
      const before = text.slice(0, cursor);
      const match = before.match(/@([\wа-яёА-ЯЁ]*)$/);
      if (match) {
        setMentionQuery(match[1]);
        setMentionStart(cursor - match[0].length);
        setMentionOpen(true);
      } else {
        setMentionOpen(false);
      }
    } catch { setMentionOpen(false); }

    onChange(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') { e.preventDefault(); return; }
    if (!mentionOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); }
    if (e.key === 'Tab' && mentionSuggestions.length > 0) { e.preventDefault(); insertMention(mentionSuggestions[0]); }
  }

  function insertMention(el: VideoElement) {
    const editor = editorRef.current;
    if (!editor) return;

    const cursorNow = getCursorPos(editor);
    const text = internalRef.current;
    const before = text.slice(0, mentionStart);
    const after = text.slice(cursorNow);
    const newText = `${before}${el.handle} ${after}`;

    isBusyRef.current = true;
    editor.innerHTML = buildHTML(newText, handleMap);
    isBusyRef.current = false;
    internalRef.current = newText;
    setIsEmpty(false);
    setMentionOpen(false);

    const newPos = mentionStart + el.handle.length + 1;
    requestAnimationFrame(() => {
      editor.focus();
      setCursorAt(editor, newPos);
    });
    onChange(newText);
  }

  const mentionSuggestions = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase();
    return elements
      .filter((el) => q === '' || el.name.toLowerCase().includes(q) || el.handle.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionOpen, mentionQuery, elements]);

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Промпт</span>
        <span className="text-[10px] text-slate-500">{value.length}/{maxLength}</span>
      </div>

      <div className="relative">
        {isEmpty ? (
          <p className="pointer-events-none absolute left-0 top-0 select-none text-sm leading-6 text-slate-500">
            {placeholder}
          </p>
        ) : null}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setMentionOpen(false), 120)}
          className="relative min-h-[96px] w-full text-sm leading-6 text-white outline-none"
          style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
        />

        {mentionOpen && mentionSuggestions.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/15 bg-[#1a1c1e] shadow-2xl shadow-black/60">
            {mentionSuggestions.map((el) => (
              <button
                key={el.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(el); }}
                className="flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-2.5 text-left last:border-0 hover:bg-white/[0.07]"
              >
                {el.imageUrl ? (
                  <img src={el.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm">
                    {el.category === 'character' ? '👤' : el.category === 'location' ? '📍' : el.category === 'prop' ? '🎒' : '📁'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">{el.handle}</p>
                  <p className="text-[11px] text-slate-500">{el.name} · {CATEGORY_LABELS[el.category]}</p>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onEnhance}
        disabled={isEmpty}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
      >
        <WandSparkles className="h-3 w-3" />
        Улучшить промпт
      </button>
    </div>
  );
}
