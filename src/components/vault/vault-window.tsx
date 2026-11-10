"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { parseIndex, resolveName, searchNotes, sourceUrl, type VaultIndex, type VaultNote } from "@/lib/vault-index";
import { createVaultMarkdown } from "@/lib/vault-markdown";
import { IconBack, IconChevron, IconClose, IconExternal, IconForward } from "./icons";
import { VaultGraph } from "./vault-graph";

type IndexState = { status: "loading" } | { status: "ready"; index: VaultIndex } | { status: "missing" } | { status: "error"; message: string };
type NoteState = { id: string; status: "loading" | "missing" | "error" } | { id: string; status: "ready"; text: string };
type Pane = "files" | "note" | "links";

const PAGE = 100;
const MAX_BACKLINKS = 50;
const REPO_URL = "https://github.com/Bombu2026/dao-vault";
const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

let indexRequest: Promise<IndexState> | null = null;
const noteCache = new Map<string, string>();

function loadIndex(): Promise<IndexState> {
  indexRequest ??= fetch("/vault/index.json")
    .then(async (res): Promise<IndexState> => {
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) return { status: "error", message: `The server answered HTTP ${res.status}.` };
      return { status: "ready", index: parseIndex(await res.json()) };
    })
    .catch((e: unknown): IndexState => ({ status: "error", message: e instanceof Error ? e.message : "Network error." }))
    .then((state) => {
      if (state.status !== "ready") indexRequest = null;
      return state;
    });
  return indexRequest;
}

async function loadNote(id: string): Promise<NoteState> {
  const cached = noteCache.get(id);
  if (cached !== undefined) return { id, status: "ready", text: cached };
  try {
    const res = await fetch(`/vault/notes/${id}.md`);
    if (res.status === 404) return { id, status: "missing" };
    if (!res.ok) return { id, status: "error" };
    const text = await res.text();
    noteCache.set(id, text);
    return { id, status: "ready", text };
  } catch {
    return { id, status: "error" };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function folderOf(note: VaultNote): string {
  const slash = note.path.lastIndexOf("/");
  return slash < 0 ? "" : note.path.slice(0, slash);
}

function stripTitle(text: string): string {
  return text.replace(/^\s*#[ \t]+[^\n]*\n?/, "");
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isSinglePane(): boolean {
  return !window.matchMedia("(min-width: 1024px)").matches;
}

type Props = {
  request: { id: string | null; seq: number };
  onClose: () => void;
  onCount: (n: number) => void;
  onNavigate: (id: string | null) => void;
};

export function VaultWindow({ request, onClose, onCount, onNavigate }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const noteScrollRef = useRef<HTMLDivElement>(null);
  const noteTitleRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusTitleNext = useRef(false);
  const currentIdRef = useRef<string | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "loading" });
  const [nav, setNav] = useState<{ stack: string[]; pos: number }>({ stack: [], pos: -1 });
  const [note, setNote] = useState<NoteState | null>(null);
  const [pane, setPane] = useState<Pane>("note");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<number, number>>({});
  const deferredQuery = useDeferredValue(query);

  const index = indexState.status === "ready" ? indexState.index : null;
  const currentId = nav.pos >= 0 ? nav.stack[nav.pos] : null;
  const current = index && currentId !== null ? (index.byId.get(currentId) ?? null) : null;

  const fetchIndex = useCallback(() => {
    setIndexState({ status: "loading" });
    void loadIndex().then(setIndexState);
  }, []);

  useEffect(fetchIndex, [fetchIndex]);

  useEffect(() => {
    if (index) onCount(index.notes.length);
  }, [index, onCount]);

  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const go = useCallback((id: string, focusTitle: boolean) => {
    if (id === currentIdRef.current) {
      if (focusTitle) noteTitleRef.current?.focus({ preventScroll: true });
      return;
    }
    focusTitleNext.current = focusTitle;
    setNav((n) => (n.stack[n.pos] === id ? n : { stack: [...n.stack.slice(0, n.pos + 1), id], pos: n.pos + 1 }));
  }, []);

  useEffect(() => {
    if (!index) return;
    const id = request.id ?? (index.home !== null ? index.notes[index.home].id : null);
    if (id) go(id, false);
  }, [index, request, go]);

  useEffect(() => {
    if (!index) return;
    onNavigate(currentId);
    const hash = currentId ? `#vault/${currentId}` : "#vault";
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", hash);
  }, [index, currentId, onNavigate]);

  useEffect(() => {
    if (current === null || !index) return;
    const id = index.notes[current].id;
    let live = true;
    setNote({ id, status: "loading" });
    void loadNote(id).then((s) => live && setNote(s));
    noteScrollRef.current?.scrollTo({ top: 0 });
    if (focusTitleNext.current) {
      focusTitleNext.current = false;
      noteTitleRef.current?.focus({ preventScroll: true });
    }
    return () => {
      live = false;
    };
  }, [index, current]);

  // Dialog plumbing: initial focus, scroll lock, focus containment.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    dialogRef.current?.focus();
    function keepFocus(e: FocusEvent) {
      if (dialogRef.current && e.target instanceof Node && !dialogRef.current.contains(e.target)) dialogRef.current.focus();
    }
    document.addEventListener("focusin", keepFocus);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("focusin", keepFocus);
    };
  }, []);

  function onDialogKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const openNote = useCallback(
    (i: number, from: "list" | "content") => {
      if (!index) return;
      const single = isSinglePane();
      if (single) setPane("note");
      go(index.notes[i].id, from === "content" || single);
    },
    [index, go],
  );

  const section = current !== null && index ? index.notes[current].section : null;
  const render = useMemo(
    () =>
      index
        ? createVaultMarkdown((target) => {
            const hit = resolveName(index, target, section);
            return hit === null ? null : { id: index.notes[hit].id, title: index.notes[hit].title };
          })
        : null,
    [index, section],
  );
  const html = useMemo(
    () => (render && note?.status === "ready" ? render(stripTitle(note.text)) : ""),
    [render, note],
  );

  const search = useMemo(() => (index ? searchNotes(index, deferredQuery) : null), [index, deferredQuery]);

  function onNoteClick(e: MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !index) return;
    const link = (e.target as Element).closest("a[data-note]");
    const id = link?.getAttribute("data-note");
    if (!id) return;
    e.preventDefault();
    if (index.byId.has(id)) go(id, true);
  }

  function searchTag(tag: string) {
    setQuery(`#${tag}`);
    setPane("files");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  const backlinks = current !== null && index ? index.backlinks[current] : [];
  const canBack = nav.pos > 0;
  const canForward = nav.pos < nav.stack.length - 1;

  const headerButton =
    "grid size-9 shrink-0 place-items-center rounded-md text-ink transition-colors hover:bg-raised aria-disabled:cursor-default aria-disabled:text-faint aria-disabled:hover:bg-transparent motion-reduce:transition-none";

  return createPortal(
    <div className="fixed inset-0 z-50 flex lg:p-6 xl:p-8">
      <div className="absolute inset-0 bg-canvas/85" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKey}
        className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-surface outline-none lg:rounded-xl lg:border lg:border-line-strong"
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-2 sm:px-3">
          <button
            type="button"
            className={headerButton}
            onClick={() => canBack && setNav((n) => ({ ...n, pos: n.pos - 1 }))}
            aria-disabled={!canBack}
            aria-label="Back"
            title="Back"
          >
            <IconBack />
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => canForward && setNav((n) => ({ ...n, pos: n.pos + 1 }))}
            aria-disabled={!canForward}
            aria-label="Forward"
            title="Forward"
          >
            <IconForward />
          </button>
          <h2 id={titleId} className="ml-2 min-w-0 flex-1 truncate text-[15px] font-bold">
            Knowledge vault
            {index && (
              <span className="ml-2.5 font-mono text-xs font-medium tabular-nums text-muted">
                {index.notes.length.toLocaleString("en-US")} notes
              </span>
            )}
          </h2>
          <button type="button" className={headerButton} onClick={onClose} aria-label="Close the vault" title="Close (Esc)">
            <IconClose />
          </button>
        </header>

        <div role="group" aria-label="Pane" className="grid shrink-0 grid-cols-3 gap-1 border-b border-line p-2 lg:hidden">
          {(["Files", "Note", "Links"] as const).map((label) => {
            const p = label.toLowerCase() as Pane;
            return (
            <button
              key={p}
              type="button"
              aria-pressed={pane === p}
              onClick={() => setPane(p)}
              className={`min-h-9 rounded-md text-sm font-bold transition-colors motion-reduce:transition-none ${
                pane === p ? "bg-raised text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
              {p === "links" && index && current !== null && (
                <span className="ml-1.5 font-mono text-[11px] font-medium tabular-nums text-muted">{backlinks.length}</span>
              )}
            </button>
            );
          })}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)_19rem] xl:grid-cols-[19rem_minmax(0,1fr)_22rem]">
          <aside
            aria-label="Files"
            className={`${pane === "files" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col lg:flex lg:border-r lg:border-line`}
          >
            <div className="shrink-0 border-b border-line p-3">
              <label htmlFor={`${titleId}-search`} className="sr-only">
                Search notes by title or tag
              </label>
              <input
                ref={searchRef}
                id={`${titleId}-search`}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles and tags"
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-md border border-input-border bg-canvas px-3 text-[15px] text-ink outline-none placeholder:text-faint focus-visible:border-accent"
              />
              <p className="mt-2 text-xs leading-snug text-muted">Titles and tags only, not full text. Start with # to match tags only.</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {!index ? (
                <p className="px-2 py-2 text-sm text-muted">{indexState.status === "loading" ? "Loading the file list…" : "No file list."}</p>
              ) : search && query.trim() ? (
                <SearchResults index={index} query={deferredQuery} result={search} current={current} onOpen={(i) => openNote(i, "list")} />
              ) : (
                <SectionTree
                  index={index}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  current={current}
                  onOpen={(i) => openNote(i, "list")}
                />
              )}
            </div>
          </aside>

          <div
            ref={noteScrollRef}
            className={`${pane === "note" ? "block" : "hidden"} min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-canvas lg:block`}
          >
            <NoteView
              indexState={indexState}
              index={index}
              current={current}
              currentId={currentId}
              note={note}
              html={html}
              backlinkCount={backlinks.length}
              titleRef={noteTitleRef}
              onRetryIndex={() => {
                indexRequest = null;
                fetchIndex();
              }}
              onRetryNote={() => {
                if (current === null || !index) return;
                const id = index.notes[current].id;
                setNote({ id, status: "loading" });
                void loadNote(id).then(setNote);
              }}
              onHome={() => index && index.home !== null && go(index.notes[index.home].id, true)}
              onTag={searchTag}
              onBodyClick={onNoteClick}
            />
          </div>

          <aside
            aria-label="Links"
            className={`${pane === "links" ? "block" : "hidden"} min-h-0 min-w-0 overflow-y-auto overscroll-contain lg:block lg:border-l lg:border-line`}
          >
            {index && current !== null ? (
              <>
                <section aria-labelledby={`${titleId}-graph`} className="p-4">
                  <PaneHeading id={`${titleId}-graph`} meta={graphMeta(index, current)}>
                    Local graph
                  </PaneHeading>
                  <div className="mt-3">
                    <VaultGraph index={index} current={current} onOpen={(i) => openNote(i, "content")} />
                  </div>
                </section>
                <section aria-labelledby={`${titleId}-backlinks`} className="border-t border-line p-4">
                  <PaneHeading id={`${titleId}-backlinks`} meta={backlinks.length.toLocaleString("en-US")}>
                    Linked mentions
                  </PaneHeading>
                  {backlinks.length === 0 ? (
                    <p className="mt-3 text-sm leading-snug text-muted">No other note links here.</p>
                  ) : (
                    <>
                      <ul className="mt-2 -mx-2">
                        {backlinks.slice(0, MAX_BACKLINKS).map((i) => (
                          <li key={i}>
                            <NoteRow index={index} i={i} active={false} withSection onOpen={(j) => openNote(j, "content")} />
                          </li>
                        ))}
                      </ul>
                      {backlinks.length > MAX_BACKLINKS && (
                        <p className="mt-2 font-mono text-[11px] text-muted">
                          Showing {MAX_BACKLINKS} of {backlinks.length.toLocaleString("en-US")}
                        </p>
                      )}
                    </>
                  )}
                </section>
              </>
            ) : (
              <p className="p-4 text-sm text-muted">Open a note to see what links to it.</p>
            )}
          </aside>
        </div>

        <footer className="shrink-0 border-t border-line px-4 py-2.5 font-mono text-[11px] leading-relaxed text-muted">
          Notes from{" "}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">
            Bombu2026/dao-vault
          </a>
          {index && (
            <>
              {" "}at{" "}
              <a
                href={`${REPO_URL}/tree/${index.commit}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent"
              >
                {index.commit.slice(0, 7)}
              </a>
            </>
          )}{" "}
          ·{" "}
          <a href={LICENCE_URL} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-accent">
            CC BY-SA 4.0
          </a>{" "}
          · read-only snapshot
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function graphMeta(index: VaultIndex, current: number): string {
  const total = new Set([...index.notes[current].links, ...index.backlinks[current]]).size;
  return total > 24 ? `24 of ${total.toLocaleString("en-US")}` : String(total);
}

function PaneHeading({ id, meta, children }: { id: string; meta: string; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center justify-between gap-2 text-[15px] font-bold text-muted">
      {children}
      <span className="font-mono text-xs font-medium tabular-nums">{meta}</span>
    </h3>
  );
}

function NoteRow({
  index,
  i,
  active,
  withSection,
  onOpen,
}: {
  index: VaultIndex;
  i: number;
  active: boolean;
  withSection?: boolean;
  onOpen: (i: number) => void;
}) {
  const n = index.notes[i];
  const where = [withSection ? index.sections[n.section].name : "", folderOf(n)].filter(Boolean).join(" / ");
  return (
    <button
      type="button"
      onClick={() => onOpen(i)}
      aria-current={active ? "page" : undefined}
      className={`block w-full rounded-md border-l-[3px] px-2 py-1.5 text-left text-sm leading-snug transition-colors motion-reduce:transition-none [overflow-wrap:anywhere] ${
        active ? "border-l-accent bg-raised text-ink" : "border-l-transparent text-ink hover:bg-raised"
      }`}
    >
      {n.title}
      {where && <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">{where}</span>}
    </button>
  );
}

function SearchResults({
  index,
  query,
  result,
  current,
  onOpen,
}: {
  index: VaultIndex;
  query: string;
  result: { total: number; results: number[] };
  current: number | null;
  onOpen: (i: number) => void;
}) {
  return (
    <div>
      <p role="status" className={result.total === 0 ? "px-2 py-1.5 text-sm leading-snug text-muted" : "px-2 py-1.5 font-mono text-[11px] text-muted"}>
        {result.total === 0
          ? `No title or tag matches “${query.trim()}”. Full-text search is not available.`
          : result.total > result.results.length
            ? `Showing ${result.results.length} of ${result.total.toLocaleString("en-US")}`
            : `${result.total} ${result.total === 1 ? "match" : "matches"}`}
      </p>
      {result.total > 0 && (
        <ul>
          {result.results.map((i) => (
            <li key={i}>
              <NoteRow index={index} i={i} active={i === current} withSection onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTree({
  index,
  expanded,
  setExpanded,
  current,
  onOpen,
}: {
  index: VaultIndex;
  expanded: Record<number, number>;
  setExpanded: (fn: (e: Record<number, number>) => Record<number, number>) => void;
  current: number | null;
  onOpen: (i: number) => void;
}) {
  const baseId = useId();
  return (
    <ul aria-label="Sections">
      {index.sections.map((s, k) => {
        const shown = expanded[k] ?? 0;
        const open = shown > 0;
        const list = index.bySection[k];
        return (
          <li key={s.name}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? `${baseId}-${k}` : undefined}
              onClick={() =>
                setExpanded((e) => {
                  const next = { ...e };
                  if (open) delete next[k];
                  else next[k] = PAGE;
                  return next;
                })
              }
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-muted transition-colors hover:bg-raised hover:text-ink motion-reduce:transition-none"
            >
              <IconChevron open={open} />
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold uppercase tracking-wider text-ink">
                {s.name || "Root"}
              </span>
              <span className="font-mono text-[11px] tabular-nums">{s.count.toLocaleString("en-US")}</span>
            </button>
            {open && (
              <div id={`${baseId}-${k}`} className="mb-2 ml-[15px] border-l border-line pl-2">
                <ul>
                  {list.slice(0, shown).map((i) => (
                    <li key={i}>
                      <NoteRow index={index} i={i} active={i === current} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
                {shown < list.length && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [k]: shown + PAGE }))}
                    className="mt-1 flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm font-bold text-ink transition-colors hover:bg-raised motion-reduce:transition-none"
                  >
                    Show more
                    <span className="font-mono text-[11px] font-medium tabular-nums text-muted">
                      {shown} of {list.length.toLocaleString("en-US")}
                    </span>
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatePanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 py-10 sm:px-8">
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

const retryClass =
  "inline-flex min-h-11 items-center rounded-md border border-line-strong px-[22px] text-base font-bold text-ink transition-colors hover:bg-raised motion-reduce:transition-none";

function NoteView({
  indexState,
  index,
  current,
  currentId,
  note,
  html,
  backlinkCount,
  titleRef,
  onRetryIndex,
  onRetryNote,
  onHome,
  onTag,
  onBodyClick,
}: {
  indexState: IndexState;
  index: VaultIndex | null;
  current: number | null;
  currentId: string | null;
  note: NoteState | null;
  html: string;
  backlinkCount: number;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onRetryIndex: () => void;
  onRetryNote: () => void;
  onHome: () => void;
  onTag: (tag: string) => void;
  onBodyClick: (e: MouseEvent<HTMLDivElement>) => void;
}) {
  if (indexState.status === "loading") {
    return (
      <StatePanel title="Loading the vault index…">
        <p role="status">Fetching the list of notes. It is loaded once, when the window first opens.</p>
      </StatePanel>
    );
  }
  if (indexState.status === "missing") {
    return (
      <StatePanel title="The vault data has not been generated">
        <p>
          This build has no <code className="font-mono text-sm text-ink">public/vault/index.json</code>. Run{" "}
          <code className="font-mono text-sm text-ink">bun run vault</code>, then reload the page.
        </p>
      </StatePanel>
    );
  }
  if (indexState.status === "error" || !index) {
    return (
      <StatePanel title="Could not load the vault index">
        <p>{indexState.status === "error" ? indexState.message : ""}</p>
        <button type="button" onClick={onRetryIndex} className={retryClass}>
          Retry
        </button>
      </StatePanel>
    );
  }
  if (current === null) {
    if (currentId !== null) {
      return (
        <StatePanel title="This note is not in the snapshot">
          <p>
            No note has the id <code className="font-mono text-sm text-ink [overflow-wrap:anywhere]">{currentId}</code>.
          </p>
          {index.home !== null && (
            <button type="button" onClick={onHome} className={retryClass}>
              Open the master index
            </button>
          )}
        </StatePanel>
      );
    }
    return (
      <StatePanel title="Welcome to the knowledge vault">
        <p>
          {index.notes.length.toLocaleString("en-US")} notes on DAO governance in {index.sections.length} sections. Pick a
          section in Files or search titles and tags.
        </p>
      </StatePanel>
    );
  }

  const n = index.notes[current];
  const folder = folderOf(n);
  return (
    <article className="mx-auto w-full max-w-[46rem] px-4 py-6 sm:px-8 sm:py-10">
      <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-accent [overflow-wrap:anywhere]">
        {index.sections[n.section].name}
        {folder && <span className="text-muted"> / {folder}</span>}
      </p>
      <h3
        ref={titleRef}
        tabIndex={-1}
        className="mt-3 text-[clamp(1.5rem,2vw+0.9rem,2.25rem)] font-extrabold leading-[1.08] tracking-[-0.03em] outline-none [overflow-wrap:anywhere]"
      >
        {n.title}
      </h3>
      {n.tags.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
          {n.tags.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => onTag(index.tags[t])}
                title={`Search the tag ${index.tags[t]}`}
                className="rounded-full border border-line-strong px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink motion-reduce:transition-none"
              >
                #{index.tags[t]}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-5">
        <p className="font-mono text-xs tabular-nums text-muted">
          {formatBytes(n.bytes)} · {n.links.length} links out · {backlinkCount} linked mentions
        </p>
        <a
          href={sourceUrl(index, n)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent"
        >
          View source on GitHub
          <IconExternal />
        </a>
      </div>
      {!note || note.id !== n.id || note.status === "loading" ? (
        <p role="status" className="mt-6 text-sm text-muted">
          Loading the note…
        </p>
      ) : note.status === "missing" ? (
        <p className="mt-6 text-[15px] leading-relaxed text-muted">
          This note is listed in the index but its file is missing. Rebuild the data with{" "}
          <code className="font-mono text-sm text-ink">bun run vault</code>.
        </p>
      ) : note.status === "error" ? (
        <div className="mt-6 space-y-4">
          <p className="text-[15px] leading-relaxed text-muted">Could not load this note.</p>
          <button type="button" onClick={onRetryNote} className={retryClass}>
            Retry
          </button>
        </div>
      ) : (
        // Built by vault-markdown: every piece of note HTML is escaped and only http(s)/mailto links survive.
        <div className="vault-prose mt-6" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </article>
  );
}
