import { Marked, Renderer, type Tokens } from "marked";

export type WikiTarget = { id: string; title: string };
export type WikiResolver = (target: string) => WikiTarget | null;

type WikilinkToken = Tokens.Generic & { type: "wikilink"; raw: string; target: string; heading: string; alias: string };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Text nodes keep character references such as &mdash; (they can only ever decode to text).
function escapeText(s: string): string {
  return s.replace(/[<>"']|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, (c) => HTML_ESCAPES[c]);
}

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Absolute http(s) or mailto URL, normalised; null for anything else (relative, javascript:, data:, ...). */
export function safeUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href.trim());
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const EXTERNAL = 'target="_blank" rel="noopener noreferrer nofollow"';

function externalLink(href: string, label: string, title?: string | null): string {
  const t = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${t} ${EXTERNAL}>${label}</a>`;
}

// Obsidian lets [[Note|alias]] sit inside table rows; GFM would split the row on that pipe.
function escapeWikiPipesInTables(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => (/^\s*\|/.test(line) ? line.replace(/\[\[[^[\]\n]*\]\]/g, (m) => m.replace(/(^|[^\\])\|/g, "$1\\|")) : line))
    .join("\n");
}

const WIKILINK = /^\[\[([^[\]\n]+?)\]\]/;

/** Builds a renderer whose output contains no HTML from the note itself: tags, scripts and handlers come out as text. */
export function createVaultMarkdown(resolve: WikiResolver): (markdown: string) => string {
  const marked = new Marked({
    gfm: true,
    hooks: {
      preprocess: escapeWikiPipesInTables,
    },
    extensions: [
      {
        name: "wikilink",
        level: "inline",
        start(src: string) {
          const i = src.indexOf("[[");
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string): WikilinkToken | undefined {
          const m = WIKILINK.exec(src);
          if (!m) return undefined;
          const inner = m[1].replace(/\\\|/g, "|");
          const bar = inner.indexOf("|");
          const ref = (bar < 0 ? inner : inner.slice(0, bar)).trim();
          const hash = ref.indexOf("#");
          return {
            type: "wikilink",
            raw: m[0],
            target: (hash < 0 ? ref : ref.slice(0, hash)).trim(),
            heading: hash < 0 ? "" : ref.slice(hash + 1).trim(),
            alias: bar < 0 ? "" : inner.slice(bar + 1).trim(),
          };
        },
        renderer(token: Tokens.Generic) {
          const { target, heading, alias } = token as WikilinkToken;
          const label = escapeHtml(alias || (heading ? (target ? `${target} > ${heading}` : heading) : target));
          if (!target) return `<span class="wikilink-self">${label}</span>`;
          const hit = resolve(target);
          if (!hit) return `<span class="wikilink-missing" title="Not in the vault">${label}</span>`;
          return `<a class="wikilink" href="#vault/${escapeHtml(hit.id)}" data-note="${escapeHtml(hit.id)}" title="${escapeHtml(hit.title)}">${label}</a>`;
        },
      },
    ],
    renderer: {
      html({ text, block }: Tokens.HTML | Tokens.Tag) {
        const escaped = escapeHtml(text);
        return block ? `<p class="vault-raw">${escaped}</p>\n` : escaped;
      },
      // marked passes text that follows an inline <pre>/<script> tag through unescaped; never trust that flag.
      text(token: Tokens.Text | Tokens.Escape) {
        if ("tokens" in token && token.tokens) return this.parser.parseInline(token.tokens);
        return escapeText(token.text);
      },
      link({ href, title, tokens }: Tokens.Link) {
        const label = this.parser.parseInline(tokens);
        const url = safeUrl(href);
        return url ? externalLink(url, label, title) : `<span class="vault-dead-link">${label}</span>`;
      },
      image({ href, title, text, tokens }: Tokens.Image) {
        const alt = escapeHtml(tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text) || "image";
        const url = safeUrl(href);
        return url ? externalLink(url, `Image: ${alt}`, title) : `<span class="vault-dead-link">Image: ${alt}</span>`;
      },
      table(token: Tokens.Table) {
        return `<div class="vault-table">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
    },
  });

  return (markdown: string) => marked.parse(markdown, { async: false });
}
