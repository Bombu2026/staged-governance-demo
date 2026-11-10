export type VaultNote = {
  i: number;
  id: string;
  title: string;
  section: number;
  path: string;
  bytes: number;
  tags: number[];
  links: number[];
};

export type VaultIndex = {
  repo: string;
  commit: string;
  home: number | null;
  totals: { notes: number; links: number; unresolvedTargets: number };
  sections: { name: string; count: number }[];
  tags: string[];
  notes: VaultNote[];
  byId: Map<string, number>;
  byName: Map<string, number[]>;
  backlinks: number[][];
  bySection: number[][];
};

export class VaultFormatError extends Error {}

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isIntArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isInt);

function invalid(what: string): never {
  throw new VaultFormatError(`Invalid vault index: ${what}`);
}

export function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

export function parseIndex(raw: unknown): VaultIndex {
  if (typeof raw !== "object" || raw === null) invalid("not an object");
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) invalid("unknown format version");
  if (typeof r.repo !== "string" || typeof r.commit !== "string" || !/^[0-9a-f]{40}$/.test(r.commit)) invalid("repo or commit");
  const totals = r.totals as Record<string, unknown> | undefined;
  if (!totals || !isInt(totals.notes) || !isInt(totals.links) || !isInt(totals.unresolvedTargets)) invalid("totals");
  if (!Array.isArray(r.sections) || !Array.isArray(r.tags) || !Array.isArray(r.notes)) invalid("sections, tags or notes");

  const sections = r.sections.map((s: unknown) => {
    if (!Array.isArray(s) || typeof s[0] !== "string" || !isInt(s[1])) invalid("section entry");
    return { name: s[0] as string, count: s[1] as number };
  });
  const tags = r.tags.map((t: unknown) => (typeof t === "string" ? t : invalid("tag")));
  const count = r.notes.length;
  const notes = r.notes.map((n: unknown, i: number): VaultNote => {
    if (!Array.isArray(n) || n.length !== 7) invalid(`note ${i}`);
    const [id, title, section, path, bytes, tagIdx, links] = n as unknown[];
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) invalid(`note ${i} id`);
    if (typeof title !== "string" || typeof path !== "string" || !isInt(bytes)) invalid(`note ${i} fields`);
    if (!isInt(section) || section < 0 || section >= sections.length) invalid(`note ${i} section`);
    if (!isIntArray(tagIdx) || tagIdx.some((t) => t < 0 || t >= tags.length)) invalid(`note ${i} tags`);
    if (!isIntArray(links) || links.some((l) => l < 0 || l >= count)) invalid(`note ${i} links`);
    return { i, id, title, section, path, bytes, tags: tagIdx, links };
  });

  const home = isInt(r.home) && r.home >= 0 && r.home < count ? r.home : null;
  const byId = new Map(notes.map((n) => [n.id, n.i]));
  const byName = new Map<string, number[]>();
  const bySection: number[][] = sections.map(() => []);
  for (const n of notes) {
    const key = noteName(n.path);
    const list = byName.get(key);
    if (list) list.push(n.i);
    else byName.set(key, [n.i]);
    bySection[n.section].push(n.i);
  }
  for (const list of bySection) list.sort((a, b) => compareTitles(notes[a], notes[b]));

  return {
    repo: r.repo,
    commit: r.commit,
    home,
    totals: totals as VaultIndex["totals"],
    sections,
    tags,
    notes,
    byId,
    byName,
    backlinks: invertLinks(notes),
    bySection,
  };
}

function compareTitles(a: VaultNote, b: VaultNote): number {
  return a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }) || a.i - b.i;
}

export function invertLinks(notes: Pick<VaultNote, "links">[]): number[][] {
  const back: number[][] = notes.map(() => []);
  notes.forEach((n, i) => {
    for (const j of n.links) if (j !== i) back[j].push(i);
  });
  return back;
}

/** Resolves a wikilink target by file basename, case-insensitive, preferring the given section. */
export function resolveName(index: Pick<VaultIndex, "byName" | "notes">, target: string, fromSection: number | null): number | null {
  let name = target.split("#")[0].trim();
  name = name.slice(name.lastIndexOf("/") + 1).replace(/\.md$/i, "").trim().toLowerCase();
  if (!name) return null;
  const candidates = index.byName.get(name);
  if (!candidates) return null;
  return candidates.find((c) => index.notes[c].section === fromSection) ?? candidates[0];
}

export type SearchResult = { total: number; results: number[] };

export function searchNotes(index: Pick<VaultIndex, "notes" | "tags">, query: string, limit = 100): SearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { total: 0, results: [] };
  const tagOnly = q.startsWith("#");
  const terms = (tagOnly ? q.slice(1) : q).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { total: 0, results: [] };
  const phrase = terms.join(" ");

  const scored: [number, number][] = [];
  for (const n of index.notes) {
    const title = n.title.toLowerCase();
    const tags = n.tags.map((t) => index.tags[t]);
    let score: number;
    if (tagOnly) {
      if (!terms.every((t) => tags.some((tag) => tag.includes(t)))) continue;
      score = tags.includes(phrase) ? 0 : 1;
    } else {
      if (!terms.every((t) => title.includes(t) || tags.some((tag) => tag.includes(t)))) continue;
      score = title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(phrase) ? 2 : tags.includes(phrase) ? 3 : 4;
    }
    scored.push([score, n.i]);
  }
  scored.sort((a, b) => a[0] - b[0] || compareTitles(index.notes[a[1]], index.notes[b[1]]));
  return { total: scored.length, results: scored.slice(0, limit).map(([, i]) => i) };
}

/** Outgoing links and backlinks of a note, deduplicated: mutual first, then outgoing, then incoming. */
export function neighbours(index: Pick<VaultIndex, "notes" | "backlinks">, i: number) {
  const out = new Set(index.notes[i].links);
  const inc = new Set(index.backlinks[i]);
  const list: { i: number; out: boolean; in: boolean }[] = [];
  for (const j of out) if (inc.has(j)) list.push({ i: j, out: true, in: true });
  for (const j of out) if (!inc.has(j)) list.push({ i: j, out: true, in: false });
  for (const j of inc) if (!out.has(j)) list.push({ i: j, out: false, in: true });
  return list;
}

export function sourceUrl(index: Pick<VaultIndex, "repo" | "commit" | "sections">, note: VaultNote): string {
  const segments = [index.sections[note.section].name, ...note.path.split("/")].filter(Boolean);
  segments[segments.length - 1] += ".md";
  return `https://github.com/${index.repo}/blob/${index.commit}/Knowledge/${segments.map(encodeURIComponent).join("/")}`;
}
