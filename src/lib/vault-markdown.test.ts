import { describe, expect, it } from "vitest";
import { createVaultMarkdown, safeUrl } from "./vault-markdown";

const notes: Record<string, { id: string; title: string }> = {
  a: { id: "01-governance-a", title: "Note A" },
  "with space": { id: "02-daos-with-space", title: "With space" },
};
const render = createVaultMarkdown((target) => notes[target.toLowerCase()] ?? null);

function hrefs(html: string): string[] {
  return [...html.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1]);
}

const ALLOWED_TAGS = new Set("p a span div code pre em strong del blockquote ul ol li h1 h2 h3 h4 h5 h6 hr br table thead tbody tr th td input".split(" "));

// Every "<" left in the output opens a tag the renderer wrote itself; note text only survives as &lt;.
function expectNoActiveHtml(html: string) {
  for (const [tag, name] of html.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>/g)) {
    expect(ALLOWED_TAGS.has(name.toLowerCase()), tag).toBe(true);
    expect(tag).not.toMatch(/\son\w+\s*=/i);
    if (name === "input") expect(tag).toContain('type="checkbox"');
  }
  for (const href of hrefs(html)) expect(href).toMatch(/^(https?:|mailto:|#vault\/)/);
}

describe("vault markdown: raw HTML never reaches the page", () => {
  it("escapes a block script", () => {
    const html = render("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expectNoActiveHtml(html);
  });

  it("escapes an inline script inside a paragraph", () => {
    const html = render("before <script>alert(1)</script> after");
    expect(html).toContain("&lt;script&gt;");
    expectNoActiveHtml(html);
  });

  it("escapes an img with an onerror handler, block and inline", () => {
    for (const src of ["<img src=x onerror=alert(1)>", "text <img src=x onerror=alert(1)> text"]) {
      const html = render(src);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expectNoActiveHtml(html);
    }
  });

  it("escapes text that follows an inline raw tag (marked would pass it through)", () => {
    const html = render("x <script> <img/src=x onerror=alert(1)> </script>");
    expect(html).toContain("&lt;img/src=x onerror=alert(1)&gt;");
    expectNoActiveHtml(html);
  });

  it("keeps character references as text", () => {
    expect(render("a &mdash; b &#60;script&#62;")).toBe("<p>a &mdash; b &lt;script&gt;</p>\n");
  });
});

describe("vault markdown: links", () => {
  it("drops javascript: and other unsafe hrefs", () => {
    for (const src of [
      "[x](javascript:alert(1))",
      "[x](JaVaScRiPt:alert(1))",
      "[x]( javascript:alert(1) )",
      "<javascript:alert(1)>",
      "[x](data:text/html,<script>alert(1)</script>)",
      "[x](vbscript:msgbox(1))",
    ]) {
      const html = render(src);
      expect(html).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
      expectNoActiveHtml(html);
    }
    expect(render("[x](javascript:alert(1))")).toBe('<p><span class="vault-dead-link">x</span></p>\n');
  });

  it("renders relative links as plain text", () => {
    expect(render("[other](other-note.md)")).toBe('<p><span class="vault-dead-link">other</span></p>\n');
  });

  it("opens external links in a new tab without referrer or opener", () => {
    expect(render("[site](https://example.com/a?b=1&c=2)")).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">site</a></p>\n',
    );
    expect(render("<mailto:me@example.com>")).toContain('href="mailto:me@example.com"');
  });

  it("never loads remote images: they become a plain link with the alt text", () => {
    const html = render("![Turnout chart](https://example.com/chart.png)");
    expect(html).not.toContain("<img");
    expect(html).toBe(
      '<p><a href="https://example.com/chart.png" target="_blank" rel="noopener noreferrer nofollow">Image: Turnout chart</a></p>\n',
    );
    expect(render("![x](data:image/png;base64,AAAA)")).toBe('<p><span class="vault-dead-link">Image: x</span></p>\n');
  });

  it("only accepts absolute http, https and mailto URLs", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
    expect(safeUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("/relative")).toBeNull();
    expect(safeUrl("ftp://example.com")).toBeNull();
  });
});

describe("vault markdown: wikilinks", () => {
  it("links [[A]] inside the window", () => {
    expect(render("See [[A]].")).toBe(
      '<p>See <a class="wikilink" href="#vault/01-governance-a" data-note="01-governance-a" title="Note A">A</a>.</p>\n',
    );
  });

  it("uses the alias of [[A|alias]]", () => {
    expect(render("[[A|the first note]]")).toContain('data-note="01-governance-a" title="Note A">the first note</a>');
  });

  it("links [[A#H]] to the note and shows the heading", () => {
    expect(render("[[A#Heading two]]")).toContain('data-note="01-governance-a" title="Note A">A &gt; Heading two</a>');
  });

  it("renders an unresolved link as muted text", () => {
    expect(render("[[Missing note|shown]]")).toBe(
      '<p><span class="wikilink-missing" title="Not in the vault">shown</span></p>\n',
    );
  });

  it("escapes markup inside a wikilink label", () => {
    const html = render("[[<img src=x onerror=alert(1)>]]");
    expect(html).toContain('class="wikilink-missing"');
    expectNoActiveHtml(html);
  });

  it("keeps an aliased wikilink in a table cell instead of splitting the row", () => {
    const html = render("| DAO | Note |\n|---|---|\n| one | [[A|alias]] |\n| two | [[With space\\|other]] |");
    expect(html.startsWith('<div class="vault-table"><table>')).toBe(true);
    expect(html.match(/<td>/g)).toHaveLength(4);
    expect(html).toContain(">alias</a></td>");
    expect(html).toContain('data-note="02-daos-with-space" title="With space">other</a></td>');
  });

  it("ignores wikilinks inside code", () => {
    expect(render("`[[A]]`")).toBe("<p><code>[[A]]</code></p>\n");
  });
});

describe("vault markdown: GFM", () => {
  it("renders task lists, blockquotes and fenced code", () => {
    const html = render("- [x] done\n- [ ] todo\n\n> quoted\n\n```js\nconst a = '<b>';\n```");
    expect(html).toContain('<input checked="" disabled="" type="checkbox">');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<pre><code class="language-js">const a = &#39;&lt;b&gt;&#39;;');
  });
});
