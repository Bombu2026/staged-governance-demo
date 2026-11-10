import { describe, expect, it } from "vitest";
import { invertLinks, neighbours, parseIndex, resolveName, searchNotes, sourceUrl, VaultFormatError } from "./vault-index";

const COMMIT = "1d9fc9b0f69577b3437a7c410da91623ff53529f";

function fixture(notes: unknown[] = []) {
  return {
    v: 1,
    repo: "Bombu2026/dao-vault",
    commit: COMMIT,
    licence: "CC BY-SA 4.0",
    home: 0,
    totals: { notes: 4, links: 4, unresolvedTargets: 2 },
    sections: [
      ["00-INDEX", 1],
      ["01-GOVERNANCE", 2],
      ["02-DAOS", 1],
    ],
    tags: ["governance", "voting", "dao"],
    notes: notes.length
      ? notes
      : [
          ["00-index-home", "Home", 0, "Home", 120, [], [1, 2]],
          ["01-governance-quadratic-voting", "Quadratic Voting", 1, "Quadratic-Voting", 900, [0, 1], [2]],
          ["01-governance-delegation", "Delegation", 1, "models/Delegation", 400, [0], [1]],
          ["02-daos-delegation", "Delegation at Uniswap", 2, "Delegation", 300, [2], []],
        ],
  };
}

describe("parseIndex", () => {
  const index = parseIndex(fixture());

  it("expands the compact arrays", () => {
    expect(index.notes).toHaveLength(4);
    expect(index.notes[1]).toEqual({
      i: 1,
      id: "01-governance-quadratic-voting",
      title: "Quadratic Voting",
      section: 1,
      path: "Quadratic-Voting",
      bytes: 900,
      tags: [0, 1],
      links: [2],
    });
    expect(index.sections[1]).toEqual({ name: "01-GOVERNANCE", count: 2 });
    expect(index.byId.get("02-daos-delegation")).toBe(3);
    expect(index.home).toBe(0);
  });

  it("lists each section's notes sorted by title", () => {
    expect(index.bySection[1]).toEqual([2, 1]);
  });

  it("computes backlinks by inverting outgoing links", () => {
    expect(index.backlinks).toEqual([[], [0, 2], [0, 1], []]);
    expect(invertLinks([{ links: [0, 1] }, { links: [] }])).toEqual([[], [0]]);
  });

  it("rejects malformed data instead of rendering it", () => {
    expect(() => parseIndex(null)).toThrow(VaultFormatError);
    expect(() => parseIndex({ ...fixture(), v: 2 })).toThrow(VaultFormatError);
    expect(() => parseIndex(fixture([["bad id<script>", "x", 0, "x", 1, [], []]]))).toThrow(VaultFormatError);
    expect(() => parseIndex(fixture([["ok", "x", 0, "x", 1, [], [7]]]))).toThrow(VaultFormatError);
    expect(() => parseIndex(fixture([["ok", "x", 9, "x", 1, [], []]]))).toThrow(VaultFormatError);
  });
});

describe("resolveName", () => {
  const index = parseIndex(fixture());

  it("matches the file name case-insensitively and ignores headings and folders", () => {
    expect(resolveName(index, "quadratic-voting", 0)).toBe(1);
    expect(resolveName(index, "Quadratic-Voting#History", 0)).toBe(1);
    expect(resolveName(index, "some/folder/Quadratic-Voting.md", 0)).toBe(1);
    expect(resolveName(index, "Nowhere", 0)).toBeNull();
    expect(resolveName(index, "#Only heading", 0)).toBeNull();
  });

  it("prefers a note in the same section when names collide", () => {
    expect(resolveName(index, "Delegation", 2)).toBe(3);
    expect(resolveName(index, "Delegation", 1)).toBe(2);
    expect(resolveName(index, "Delegation", 0)).toBe(2);
  });
});

describe("searchNotes", () => {
  const index = parseIndex(fixture());

  it("matches titles and tags case-insensitively, best title matches first", () => {
    expect(searchNotes(index, "DELEGATION").results).toEqual([2, 3]);
    expect(searchNotes(index, "voting").results).toEqual([1]);
    expect(searchNotes(index, "governance").results).toEqual([2, 1]);
  });

  it("searches tags only with a leading #", () => {
    expect(searchNotes(index, "#dao").results).toEqual([3]);
    expect(searchNotes(index, "#delegation").total).toBe(0);
  });

  it("requires every word to match", () => {
    expect(searchNotes(index, "delegation uniswap").results).toEqual([3]);
    expect(searchNotes(index, "delegation nope").total).toBe(0);
  });

  it("returns nothing for a blank query", () => {
    expect(searchNotes(index, "   ")).toEqual({ total: 0, results: [] });
  });

  it("caps the results and reports the total", () => {
    const many = Array.from({ length: 250 }, (_, i) => [`n-${i}`, `Note ${i}`, 0, `Note-${i}`, 1, [], []]);
    const big = parseIndex(fixture(many));
    const res = searchNotes(big, "note");
    expect(res.total).toBe(250);
    expect(res.results).toHaveLength(100);
    expect(res.results.slice(0, 3)).toEqual([0, 1, 2]);
  });
});

describe("neighbours", () => {
  it("deduplicates and lists mutual links, then outgoing, then incoming", () => {
    const index = parseIndex(fixture());
    expect(neighbours(index, 1)).toEqual([{ i: 2, out: true, in: true }, { i: 0, out: false, in: true }]);
    expect(neighbours(index, 0)).toEqual([{ i: 1, out: true, in: false }, { i: 2, out: true, in: false }]);
  });
});

describe("sourceUrl", () => {
  it("points at the pinned commit and encodes each path segment", () => {
    const index = parseIndex(
      fixture([["n", "Forms of life", 1, 'foundations/The dialogical praxis – poiésis in "forms of life"', 1, [], []]]),
    );
    expect(sourceUrl(index, index.notes[0])).toBe(
      `https://github.com/Bombu2026/dao-vault/blob/${COMMIT}/Knowledge/01-GOVERNANCE/foundations/The%20dialogical%20praxis%20%E2%80%93%20poi%C3%A9sis%20in%20%22forms%20of%20life%22.md`,
    );
  });
});
