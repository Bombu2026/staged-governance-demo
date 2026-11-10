// Builds public/vault/ from the Knowledge/ folder of Bombu2026/dao-vault.
// Plain Node ESM, no dependencies. Usage: node scripts/build-vault.mjs [--check]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const VAULT_REPO = "https://github.com/Bombu2026/dao-vault.git";
const VAULT_COMMIT = "1d9fc9b0f69577b3437a7c410da91623ff53529f";
const MIN_NOTES = 1000;
// Main map of content first; the first one that exists becomes the window's home note.
const HOME_CANDIDATES = ["00-INDEX/MASTER-INDEX-2026.md", "00-INDEX/_MASTER-INDEX.md", "00-INDEX/_INDEX.md"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "vault");

if (process.argv.includes("--check")) {
  if (!fs.existsSync(path.join(outDir, "index.json"))) {
    console.warn("[vault] public/vault is missing: run `bun run vault` to generate it. The vault window shows an empty state until then.");
  }
  process.exit(0);
}

function fail(message) {
  console.error(`[vault] ${message}`);
  process.exit(1);
}

function git(args, cwd, capture = false) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", capture ? "pipe" : "inherit", capture ? "ignore" : "inherit"] });
}

function headOf(dir) {
  try {
    return git(["-C", dir, "rev-parse", "HEAD"], root, true).trim();
  } catch {
    return null;
  }
}

function locateVault() {
  if (process.env.VAULT_DIR) {
    const dir = path.resolve(process.env.VAULT_DIR);
    if (!fs.existsSync(path.join(dir, "Knowledge"))) fail(`VAULT_DIR=${dir} has no Knowledge/ folder`);
    return { dir, source: "VAULT_DIR" };
  }
  const sibling = path.resolve(root, "..", "dao-vault");
  if (fs.existsSync(path.join(sibling, "Knowledge"))) {
    const head = headOf(sibling);
    if (head && head !== VAULT_COMMIT) {
      console.warn(`[vault] ../dao-vault is at ${head.slice(0, 7)}, pinned commit is ${VAULT_COMMIT.slice(0, 7)}: source links point to the pinned commit.`);
    }
    return { dir: sibling, source: "../dao-vault" };
  }
  const cache = path.join(root, ".vault-cache");
  if (headOf(cache) !== VAULT_COMMIT || !fs.existsSync(path.join(cache, "Knowledge"))) {
    console.log(`[vault] fetching ${VAULT_REPO} @ ${VAULT_COMMIT.slice(0, 7)} into .vault-cache/`);
    fs.rmSync(cache, { recursive: true, force: true });
    fs.mkdirSync(cache, { recursive: true });
    git(["init", "-q"], cache);
    git(["fetch", "-q", "--depth", "1", VAULT_REPO, VAULT_COMMIT], cache);
    git(["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"], cache);
  }
  return { dir: cache, source: ".vault-cache" };
}

function walk(dir, rel = "", out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(childRel);
  }
  return out;
}

function slugSegment(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugPath(rel) {
  const parts = rel.replace(/\.md$/i, "").split("/");
  const base = parts.pop();
  const slugs = parts.map(slugSegment).filter(Boolean);
  slugs.push(slugSegment(base) || `n-${createHash("sha1").update(base).digest("hex").slice(0, 8)}`);
  return slugs.join("-");
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

function splitFrontmatter(text) {
  const m = FRONTMATTER.exec(text);
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: "", body: text };
}

function cleanTag(t) {
  return t.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").trim().toLowerCase();
}

function parseTags(fm) {
  const lines = fm.split(/\r?\n/);
  const i = lines.findIndex((l) => /^tags\s*:/.test(l));
  if (i < 0) return [];
  const rest = lines[i].replace(/^tags\s*:/, "").trim();
  let raw = [];
  if (rest.startsWith("[")) raw = rest.replace(/^\[|\]$/g, "").split(",");
  else if (rest) raw = rest.split(/[,\s]+/);
  else {
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^\s*-\s+(.*)$/.exec(lines[j]);
      if (m) raw.push(m[1]);
      else if (lines[j].trim() && !/^\s/.test(lines[j])) break;
    }
  }
  return [...new Set(raw.map(cleanTag).filter(Boolean))];
}

const FENCE = /^\s{0,3}(```|~~~)/;

function proseLines(body) {
  const out = [];
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const m = FENCE.exec(line);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1] === fence) fence = null;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out;
}

function plainTitle(s) {
  return s
    .replace(/\[\[([^\]|]+)(?:\\?\|([^\]]+))?\]\]/g, (_, t, a) => a ?? t)
    .replace(/[*`​-‍﻿]/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

function extractTitle(lines) {
  for (const line of lines) {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) return plainTitle(m[1]) || null;
  }
  return null;
}

const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g;

function wikiTarget(inner) {
  let target = inner.split("|")[0];
  if (target.endsWith("\\")) target = target.slice(0, -1);
  target = target.split("#")[0].trim();
  target = target.split("/").pop().trim();
  return target.replace(/\.md$/i, "");
}

function main() {
  const { dir, source } = locateVault();
  const knowledge = path.join(dir, "Knowledge");
  const files = walk(knowledge).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (files.length < MIN_NOTES) fail(`only ${files.length} notes found in ${knowledge} (expected at least ${MIN_NOTES})`);

  const usedIds = new Set();
  const notes = files.map((rel) => {
    const text = fs.readFileSync(path.join(knowledge, rel), "utf8");
    const { fm, body } = splitFrontmatter(text);
    const lines = proseLines(body);
    let id = slugPath(rel);
    for (let n = 2; usedIds.has(id); n++) id = `${slugPath(rel)}-${n}`;
    usedIds.add(id);
    const slash = rel.indexOf("/");
    const base = rel.split("/").pop().replace(/\.md$/i, "");
    const targets = [];
    for (const line of lines) {
      for (const m of line.replace(/`[^`\n]*`/g, "").matchAll(WIKILINK)) targets.push(wikiTarget(m[1]));
    }
    return {
      id,
      rel,
      body,
      base,
      section: slash < 0 ? "" : rel.slice(0, slash),
      inSection: (slash < 0 ? rel : rel.slice(slash + 1)).replace(/\.md$/i, ""),
      title: extractTitle(lines) ?? base.replace(/-/g, " ").trim(),
      tags: parseTags(fm),
      bytes: Buffer.byteLength(text),
      targets,
    };
  });

  const byName = new Map();
  notes.forEach((n, i) => {
    const key = n.base.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), i]);
  });

  const unresolved = new Set();
  let resolvedLinks = 0;
  const links = notes.map((n, i) => {
    const out = new Set();
    for (const target of n.targets) {
      if (!target) continue;
      const candidates = byName.get(target.toLowerCase());
      if (!candidates) {
        unresolved.add(target.toLowerCase());
        continue;
      }
      const j = candidates.find((c) => notes[c].section === n.section) ?? candidates[0];
      if (j !== i) out.add(j);
    }
    resolvedLinks += out.size;
    return [...out];
  });

  const sectionNames = [...new Set(notes.map((n) => n.section))].sort();
  const sectionIndex = new Map(sectionNames.map((s, i) => [s, i]));
  const tagCounts = new Map();
  for (const n of notes) for (const t of n.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts.keys()].sort((a, b) => tagCounts.get(b) - tagCounts.get(a) || (a < b ? -1 : 1));
  const tagIndex = new Map(tags.map((t, i) => [t, i]));
  const home = HOME_CANDIDATES.map((rel) => notes.findIndex((n) => n.rel === rel)).find((i) => i >= 0);

  const index = {
    v: 1,
    repo: "Bombu2026/dao-vault",
    commit: VAULT_COMMIT,
    licence: "CC BY-SA 4.0",
    home: home ?? null,
    totals: { notes: notes.length, links: resolvedLinks, unresolvedTargets: unresolved.size },
    sections: sectionNames.map((s) => [s, notes.filter((n) => n.section === s).length]),
    tags,
    // Each note: [id, title, section index, path inside the section without .md, bytes, tag indexes, linked note indexes]
    notes: notes.map((n, i) => [
      n.id,
      n.title,
      sectionIndex.get(n.section),
      n.inSection,
      n.bytes,
      n.tags.map((t) => tagIndex.get(t)),
      links[i],
    ]),
  };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "notes"), { recursive: true });
  for (const n of notes) fs.writeFileSync(path.join(outDir, "notes", `${n.id}.md`), n.body);
  const json = JSON.stringify(index);
  fs.writeFileSync(path.join(outDir, "index.json"), json);

  const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(
    `[vault] ${notes.length} notes in ${sectionNames.length} sections, ${resolvedLinks} resolved links, ${unresolved.size} unresolved targets, ` +
      `index.json ${kb(Buffer.byteLength(json))} (${kb(gzipSync(json).length)} gzipped), commit ${VAULT_COMMIT.slice(0, 7)}, source ${source}`,
  );
}

main();
