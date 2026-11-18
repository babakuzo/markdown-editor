'use client';

import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Layout, LayoutContent, LayoutHeader, LayoutPanel} from '@astryxdesign/core/Layout';
import {HStack, VStack, StackItem} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Icon} from '@astryxdesign/core/Icon';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Outline, useOutlineFromMarkdown} from '@astryxdesign/core/Outline';
import {ClickableCard} from '@astryxdesign/core/ClickableCard';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Slider} from '@astryxdesign/core/Slider';
import {Popover} from '@astryxdesign/core/Popover';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {useToast} from '@astryxdesign/core/Toast';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {
  RichTextEditor,
  RichTextEditorAutoLinkPlugin,
  markdownToEditorStateJSON,
  type RichTextEditorRef,
} from '@astryxdesign/richtext';
import {CheckListPlugin} from '@lexical/react/LexicalCheckListPlugin';
import {List, ListItem} from '@astryxdesign/core/List';
import {DocumentTextIcon, FolderOpenIcon, PencilIcon, ViewColumnsIcon} from '@heroicons/react/24/outline';
import {DragHandlePlugin, SlashInsertPlugin, buildOptions, formatText} from './EditorPlugins';
import {NOTES_MARKDOWN, NOTES_NAME, README_MARKDOWN, README_NAME, SAMPLE_MARKDOWN, SAMPLE_NAME} from './sample';

/** Build fingerprint. Lives only in markup attributes; never drawn. */
export const NOTR_BUILD = '05SA-EVI7-GUXA-GG52';

type Doc = {name: string; folder: string; markdown: string};
type Mode = 'read' | 'write';
type Stock = 'grid' | 'ruled' | 'plain';

const SEED_RECENT: Doc[] = [
  {name: SAMPLE_NAME, folder: 'Downloads', markdown: SAMPLE_MARKDOWN},
  {name: README_NAME, folder: 'code/atlas', markdown: README_MARKDOWN},
  {name: NOTES_NAME, folder: 'Documents', markdown: NOTES_MARKDOWN},
];

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

/** Front matter (--- … --- at the very top) is kept aside and written back untouched. */
function splitFrontMatter(md: string): {front: string; body: string} {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? {front: m[0], body: md.slice(m[0].length)} : {front: '', body: md};
}

function countWords(md: string): number {
  const text = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|\-[\]()]/g, ' ');
  const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯]/g) ?? []).length;
  const latin = text.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').trim();
  return cjk + (latin ? latin.split(/\s+/).length : 0);
}

const plural = new Intl.PluralRules('en');
const num = new Intl.NumberFormat('en');
function readingLine(words: number): string {
  const w = `${num.format(words)} ${plural.select(words) === 'one' ? 'word' : 'words'}`;
  if (words === 0) return 'Empty page';
  const minutes = Math.max(1, Math.round(words / 220));
  const time = minutes < 60 ? `${minutes} min read` : `${Math.floor(minutes / 60)} h ${minutes % 60} min read`;
  return `${w} · ${time}`;
}

function looksLikeText(sample: string): boolean {
  return !sample.includes('\u0000');
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/* Bridge to the native Mac shell (WKWebView). Inert in a browser. */
type NativeBridge = {postMessage: (message: {type: 'changed' | 'save'; markdown: string}) => void};
function nativeBridge(): NativeBridge | null {
  const w = window as unknown as {webkit?: {messageHandlers?: {notr?: NativeBridge}}};
  return w.webkit?.messageHandlers?.notr ?? null;
}
/** True inside the Mac app. Read after mount so the static export hydrates cleanly. */
function useIsNative(): boolean {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(nativeBridge() != null), []);
  return native;
}
declare global {
  interface Window {
    notrOpen?: (doc: {name: string; folder: string; markdown: string}) => void;
  }
}

type DownloadsNs = {save: (req: {filename: string; data: string}) => Promise<{status: string}>};
async function downloadMarkdown(name: string, markdown: string): Promise<'saved' | 'declined' | 'unavailable'> {
  const host = (window as unknown as {claude?: {use: (n: string) => Promise<unknown>}}).claude;
  if (host?.use) {
    const downloads = (await host.use('downloads')) as DownloadsNs | null;
    if (downloads == null) return 'unavailable';
    try {
      await downloads.save({filename: name, data: markdown});
      return 'saved';
    } catch (e) {
      return (e as {code?: string})?.code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  const url = URL.createObjectURL(new Blob([markdown], {type: 'text/markdown'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return 'saved';
}

/* ------------------------------------------------------------------------ */
/* App                                                                       */
/* ------------------------------------------------------------------------ */

export function Notr() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [recent, setRecent] = useState<Doc[]>(SEED_RECENT);
  const [rev, setRev] = useState(0);

  const open = useCallback((d: Doc) => {
    setRecent(r => [d, ...r.filter(x => x.name !== d.name)].slice(0, 6));
    setDoc(d);
    setRev(n => n + 1);
  }, []);

  useEffect(() => {
    window.notrOpen = d => open(d);
    return () => {
      delete window.notrOpen;
    };
  }, [open]);

  if (doc == null) return <Welcome recent={recent} onOpen={open} />;
  return <Notebook key={`${doc.folder}/${doc.name}/${rev}`} doc={doc} recent={recent} onOpen={open} onClose={() => setDoc(null)} />;
}

/* ------------------------------------------------------------------------ */
/* Welcome: an empty taped page on the desk                                  */
/* ------------------------------------------------------------------------ */

function Welcome({recent, onOpen}: {recent: Doc[]; onOpen: (d: Doc) => void}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = useCallback(
    async (f: File | File[] | null) => {
      const one = Array.isArray(f) ? f[0] : f;
      setFile(one ?? null);
      setError(null);
      if (!one) return;
      const text = await one.text();
      if (!looksLikeText(text.slice(0, 4096))) {
        setError('Notr couldn’t read this file. It may not be a text or Markdown file.');
        return;
      }
      setFile(null);
      onOpen({name: one.name, folder: 'Your Mac', markdown: text});
    },
    [onOpen],
  );

  return (
    <AppShell height="fill" variant="surface" contentPadding={0}>
      <VStack hAlign="center" className="notr-desk notr-welcome-desk" minHeight="100%" padding={10} data-notr-build={NOTR_BUILD}>
        <VStack className="notr-page notr-stock-grid notr-welcome" gap={6}>
          <Text className="notr-tape" type="label">
            START HERE
          </Text>
          <VStack gap={2}>
            <Heading level={1}>Open a Markdown file</Heading>
            <Text type="body" color="secondary" className="notr-body-face">
              It opens as a clean page you can read. When you want to change something, switch to Write.
              You never need to type Markdown.
            </Text>
          </VStack>
          <FileInput
            label="Choose a file"
            isLabelHidden
            mode="dropzone"
            placeholder="Drop a .md file here, or click to choose one"
            accept=".md,.markdown,text/markdown"
            value={file}
            onChange={onFile}
            status={error ? {type: 'error', message: error} : undefined}
            width="100%"
          />
          {recent.length > 0 ? (
            <VStack gap={3}>
              <Text type="label" className="notr-ui-face">
                Recently opened
              </Text>
              <Grid columns={3} gap={3}>
                {recent.slice(0, 3).map((r, i) => (
                  <ClickableCard key={r.name} label={`Open ${r.name}`} padding={4} className={`notr-slip notr-slip-${i}`} onClick={() => onOpen(r)}>
                    <VStack gap={1}>
                      <Text type="body" weight="semibold" maxLines={1}>
                        {r.name}
                      </Text>
                      <Text type="supporting" maxLines={1}>
                        {r.folder}
                      </Text>
                    </VStack>
                  </ClickableCard>
                ))}
              </Grid>
            </VStack>
          ) : (
            <Text type="supporting">Files you open will show up here.</Text>
          )}
        </VStack>
      </VStack>
    </AppShell>
  );
}

/* ------------------------------------------------------------------------ */
/* The notebook window                                                       */
/* ------------------------------------------------------------------------ */

function Notebook({doc, recent, onOpen, onClose}: {doc: Doc; recent: Doc[]; onOpen: (d: Doc) => void; onClose: () => void}) {
  const {front, body: initialBody} = useMemo(() => splitFrontMatter(doc.markdown), [doc.markdown]);
  const [mode, setMode] = useState<Mode>('read');
  const [body, setBody] = useState(initialBody);
  const [live, setLive] = useState(initialBody);
  const [saved, setSaved] = useState(initialBody);
  const [stock, setStock] = useState<Stock>('grid');
  const [size, setSize] = useState(18);
  const [pending, setPending] = useState<Doc | 'close' | null>(null);
  const isNarrow = useMediaQuery('(max-width: 1100px)');
  const [showOutline, setShowOutline] = useState(true);
  const editorRef = useRef<RichTextEditorRef>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const keepScroll = useRef<number | null>(null);
  const liveTimer = useRef<number | undefined>(undefined);
  const showToast = useToast();
  const isNative = useIsNative();

  const outline = useOutlineFromMarkdown(live);
  const editorState = useMemo(() => markdownToEditorStateJSON(body), [body]);
  const tray = useMemo(() => buildOptions().filter(o => o.inTray), []);
  const isDirty = live.trimEnd() !== saved.trimEnd();
  const words = countWords(live);
  const outlineVisible = showOutline && !isNarrow;

  const currentBody = useCallback(
    () => (mode === 'write' && editorRef.current ? editorRef.current.getMarkdown() : body),
    [mode, body],
  );

  /* Same page, same place: remember the scroll position across the switch. */
  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      keepScroll.current = scrollRef.current?.scrollTop ?? 0;
      if (next === 'read' && editorRef.current) {
        const md = editorRef.current.getMarkdown();
        setBody(md);
        setLive(md);
      }
      setMode(next);
    },
    [mode],
  );

  useLayoutEffect(() => {
    const top = keepScroll.current;
    if (top == null) return;
    const restore = () => {
      if (scrollRef.current) scrollRef.current.scrollTop = top;
    };
    restore();
    if (mode === 'write') {
      editorRef.current?.focus();
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(restore));
    keepScroll.current = null;
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const save = useCallback(async (): Promise<boolean> => {
    const md = currentBody();
    const full = front + md;
    setBody(md);
    setLive(md);
    const bridge = nativeBridge();
    if (bridge) {
      bridge.postMessage({type: 'save', markdown: full});
      setSaved(md);
      return true;
    }
    const result = await downloadMarkdown(doc.name, full);
    if (result === 'saved') {
      setSaved(md);
      showToast({body: `Downloaded a copy of ${doc.name}`, uniqueID: 'saved'});
      return true;
    }
    if (result === 'unavailable') {
      showToast({body: 'Saving isn’t available here. Your changes are still on the page.', type: 'error', uniqueID: 'saved'});
    }
    return false;
  }, [currentBody, front, doc.name, showToast]);

  /* Never lose edits: ask before leaving a changed page. */
  const leave = useCallback(
    (target: Doc | 'close') => {
      if (target !== 'close' && target.name === doc.name) return;
      if (isDirty) {
        setPending(target);
        return;
      }
      if (target === 'close') onClose();
      else onOpen(target);
    },
    [doc.name, isDirty, onClose, onOpen],
  );
  const finishLeave = useCallback(() => {
    const target = pending;
    setPending(null);
    if (target === 'close') onClose();
    else if (target) onOpen(target);
  }, [pending, onClose, onOpen]);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  /* Keyboard: E or ⌘E to write, Esc or ⌘E to read, ⌘S to save. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        void save();
      } else if (mod && key === 'e') {
        e.preventDefault();
        switchMode(mode === 'read' ? 'write' : 'read');
      } else if (!mod && mode === 'read' && key === 'e' && !isTyping(e.target)) {
        e.preventDefault();
        switchMode('write');
      } else if (key === 'escape' && mode === 'write' && !document.querySelector('.notr-slash, [role="dialog"]')) {
        switchMode('read');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, save, switchMode]);

  const onEditorChange = useCallback(() => {
    window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(() => {
      const md = editorRef.current?.getMarkdown();
      if (md != null) {
        setLive(md);
        nativeBridge()?.postMessage({type: 'changed', markdown: front + md});
      }
    }, 250);
  }, [front]);

  const runOnEditor = useCallback((fn: (editor: NonNullable<ReturnType<RichTextEditorRef['getEditor']>>) => void) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    editor.focus();
    fn(editor);
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      if (mode !== 'write') return;
      const index = outline.findIndex(o => o.id === id);
      const heads = scrollRef.current?.querySelectorAll('[contenteditable] h1, [contenteditable] h2, [contenteditable] h3');
      heads?.[index]?.scrollIntoView({block: 'start'});
    },
    [mode, outline],
  );

  const settings = (
    <VStack gap={4}>
      <VStack gap={2}>
        <Text type="label">Paper</Text>
        <SegmentedControl label="Paper" value={stock} onChange={v => setStock(v as Stock)} layout="fill" size="sm">
          <SegmentedControlItem value="grid" label="Grid" />
          <SegmentedControlItem value="ruled" label="Lined" />
          <SegmentedControlItem value="plain" label="Plain" />
        </SegmentedControl>
      </VStack>
      <Slider label="Text size" value={size} min={15} max={22} onChange={(v: number) => setSize(v)} formatValue={(v: number) => (v <= 16 ? 'Small' : v >= 20 ? 'Large' : 'Medium')} />
    </VStack>
  );

  return (
    <AppShell height="fill" variant="surface" contentPadding={0}>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider label="Document" padding={2}>
            <HStack gap={2} vAlign="center">
              <IconButton
                label={outlineVisible ? 'Hide outline' : 'Show outline'}
                tooltip={outlineVisible ? 'Hide outline' : 'Show outline'}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ViewColumnsIcon} />}
                onClick={() => setShowOutline(s => !s)}
                isDisabled={isNarrow}
              />
              <StackItem size="fill" xstyle={undefined}>
                <HStack gap={2} vAlign="center" className="notr-title">
                  <Text type="body" weight="semibold" maxLines={1} className="notr-filename">
                    {doc.name}
                  </Text>
                  {isNative ? null : (
                    <Text type="supporting" className={`notr-edited${isDirty ? ' is-on' : ''}`} aria-live="polite">
                      {isDirty ? 'Edited' : 'Saved'}
                    </Text>
                  )}
                </HStack>
              </StackItem>
              <SegmentedControl label="Mode" value={mode} onChange={v => switchMode(v as Mode)} size="sm">
                <SegmentedControlItem value="read" label="Read" />
                <SegmentedControlItem value="write" label="Write" icon={<Icon icon={PencilIcon} />} />
              </SegmentedControl>
              <Popover label="Paper and text" placement="below" alignment="end" width={260} content={settings}>
                <Button label="Paper and text" isIconOnly variant="ghost" size="sm" icon={<Text type="body" weight="semibold" className="notr-display-face">Aa</Text>} tooltip="Paper and text" />
              </Popover>
              <Button label="Save" size="sm" variant={isDirty ? 'primary' : 'ghost'} onClick={() => void save()} tooltip="Save (⌘S)" />
              {isNative ? null : (
                <IconButton label="Open another file" tooltip="Open another file" size="sm" variant="ghost" icon={<Icon icon={FolderOpenIcon} />} onClick={() => leave('close')} />
              )}
            </HStack>
          </LayoutHeader>
        }
        start={
          outlineVisible ? (
            <LayoutPanel width={232} label="On this page" role="complementary">
              <VStack gap={6}>
                <VStack gap={2}>
                  <Text type="label" className="notr-ui-face">
                    ON THIS PAGE
                  </Text>
                  {outline.length > 0 ? (
                    <Outline
                      items={outline}
                      density="compact"
                      label="On this page"
                      scrollContainerRef={scrollRef}
                      hasScrollOnClick={mode === 'read'}
                      onNavigateStart={jumpTo}
                    />
                  ) : (
                    <Text type="supporting">Sections you add will be listed here.</Text>
                  )}
                </VStack>
                {isNative ? null : (
                  <List
                    density="compact"
                    header={
                      <Text type="label" className="notr-ui-face">
                        RECENT
                      </Text>
                    }>
                    {recent
                      .filter(r => r.name !== doc.name)
                      .slice(0, 4)
                      .map(r => (
                        <ListItem
                          key={r.name}
                          label={r.name}
                          description={r.folder}
                          startContent={<Icon icon={DocumentTextIcon} size="sm" color="secondary" />}
                          onClick={() => leave(r)}
                        />
                      ))}
                  </List>
                )}
              </VStack>
            </LayoutPanel>
          ) : null
        }
        content={
          <LayoutContent padding={0} label="Page" ref={scrollRef}>
            <VStack hAlign="center" className="notr-desk" minHeight="100%" data-notr-build={NOTR_BUILD}>
              <VStack
                className={`notr-page notr-stock-${stock} notr-doc`}
                style={{['--notr-size' as string]: `${size}px`}}>
                <Text className="notr-tape" type="label" aria-hidden="true">
                  {mode === 'read' ? 'READING' : 'WRITING'}
                </Text>
                {mode === 'read' ? (
                  body.trim() === '' ? (
                    <EmptyState
                      title="This page is empty"
                      description="Switch to Write to start, or open another file."
                      actions={<Button label="Start writing" variant="primary" onClick={() => switchMode('write')} />}
                    />
                  ) : (
                    <Markdown contentWidth="100%">{body}</Markdown>
                  )
                ) : (
                  <RichTextEditor
                    ref={editorRef}
                    label={`Writing ${doc.name}`}
                    isLabelHidden
                    defaultValue={editorState}
                    placeholder="Start writing, or type / for a title, list or table"
                    plugins={
                      <>
                        <RichTextEditorAutoLinkPlugin />
                        <CheckListPlugin />
                        <SlashInsertPlugin />
                        <DragHandlePlugin />
                      </>
                    }
                    onChange={onEditorChange}
                    width="100%"
                    minHeight={360}
                  />
                )}
              </VStack>
              <Text type="supporting" className="notr-count">
                {readingLine(words)}
              </Text>
            </VStack>
            {mode === 'write' ? (
              <HStack className="notr-tray" gap={3} vAlign="end" role="toolbar" aria-label="Add to the page">
                {tray.map(o => (
                  <VStack key={o.key} gap={1} hAlign="center">
                    <IconButton
                      label={`Add ${o.title.toLowerCase()}`}
                      tooltip={o.description}
                      icon={<Icon icon={o.glyph} />}
                      className={`notr-sticker notr-sticker-${o.sticker}`}
                      onClick={() => runOnEditor(o.run)}
                    />
                    <Text type="supporting" className="notr-tray-label">
                      {o.title}
                    </Text>
                  </VStack>
                ))}
                <span className="notr-tray-rule" aria-hidden="true" />
                <VStack gap={1} hAlign="center">
                  <IconButton label="Bold" tooltip="Bold (⌘B)" icon={<Text weight="bold" className="notr-display-face">B</Text>} className="notr-sticker notr-sticker-ink" onClick={() => runOnEditor(e => formatText(e, 'bold'))} />
                  <Text type="supporting" className="notr-tray-label">
                    Bold
                  </Text>
                </VStack>
                <VStack gap={1} hAlign="center">
                  <IconButton label="Italic" tooltip="Italic (⌘I)" icon={<Text className="notr-display-face notr-italic">I</Text>} className="notr-sticker notr-sticker-ink" onClick={() => runOnEditor(e => formatText(e, 'italic'))} />
                  <Text type="supporting" className="notr-tray-label">
                    Italic
                  </Text>
                </VStack>
              </HStack>
            ) : null}
          </LayoutContent>
        }
      />
      <Dialog isOpen={pending != null} onOpenChange={o => !o && setPending(null)} width={420} purpose="required">
        <VStack gap={4}>
          <DialogHeader title={`Save changes to “${doc.name}”?`} />
          <Text type="body" color="secondary">
            {pending === 'close' || pending == null
              ? 'Your changes will be lost if you don’t save them.'
              : `You’re opening “${pending.name}”. Your changes here will be lost if you don’t save them.`}
          </Text>
          <HStack gap={2}>
            <StackItem size="fill">
              <Button label="Don’t Save" variant="ghost" onClick={finishLeave} />
            </StackItem>
            <Button label="Cancel" onClick={() => setPending(null)} />
            <Button
              label="Save"
              variant="primary"
              onClick={async () => {
                if (await save()) finishLeave();
              }}
            />
          </HStack>
        </VStack>
      </Dialog>
    </AppShell>
  );
}
