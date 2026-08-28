# Sift

A note app for iOS whose entire argument is that **you can find what you wrote**.

Local-first Markdown files you own, a real search engine that survives typos and
half-remembered words, `[[wikilinks]]` with backlinks, and full version history
on every note. No account, no sync to break, no subscription.

---

## Why this exists

Before writing a line of code I went through what people actually complain about
in note apps, because "make a better Notes app" is not a specification.

**What kills note apps.** Across one-star and two-star reviews of the major
players, *sync failures and lost notes account for about 22%* of the complaints —
more than pricing (17%) and offline bugs (13%) combined. Notesnook users report
notes whose titles survived while the body was erased. Goodnotes users report a
promised lifetime purchase that kept degrading. Notesnook put checklists — which
had been free — behind a paywall in late 2025. Freenotes counts *deleted* notes
against its free-tier limit.

**Where Apple Notes falls down.** Its search is essentially exact substring
matching. It misses "lightbulb" when you typed "light bulb", misses "run" when
the note says "running", and has no tolerance for a typo. There is no way to
scope a search to a folder, and there are no links between notes at all — the
single most cited reason people leave for Obsidian or Bear. The database is
opaque: your notes are not files you can take somewhere else.

**The constraint nobody designs around.** Working memory holds a new thought for
roughly 15–30 seconds. A five-second launch plus three taps to a cursor is long
enough to lose the idea you opened the app to save.

So Sift is built around four commitments:

| Commitment | How it is kept |
|---|---|
| Never lose a note | One file per note, atomic writes, append-only history written *before* the note file, 30-day trash, recovery from history on a damaged file |
| Find what you half-remember | A real search engine: BM25F ranking, typo tolerance, stemming, compound splitting, prefix matching |
| Your notes are yours | Plain Markdown files with a small frontmatter header, exportable at any time |
| Nothing to pay for | No account, no server, no subscription, no ads, no limits |

---

## The search engine

This is the part worth reading the code for. It lives in `src/core/search/` and
has no dependencies and no React — it runs under `node --experimental-strip-types`
and is covered by its own test suite.

Each query term is expanded through four layers, each with a confidence weight,
so a typo still finds the note but never outranks a clean match:

| Layer | Weight | Fixes |
|---|---|---|
| exact | 1.00 | the word as typed |
| stem | 0.85 | `running` → `runs`, `cities` → `city` |
| prefix | 0.70 | search-as-you-type, before the word is finished |
| fuzzy | 0.55 | one or two edits away (`meting` → `meeting`) |

On top of that:

- **Decompounding, both directions.** `lightbulb` finds a note that says "light
  bulb", and typing `light bulb` finds a note that says "lightbulb". The joined
  form is credited to *both* source terms so the note earns full query coverage.
- **Compound splitting at index time.** `getUserId` is findable as `get`, `user`,
  `id`, or the whole identifier. `iphone15` splits on the letter/digit boundary.
- **Diacritic folding.** `resume` finds `résumé`.
- **BM25F ranking** over three fields with independent length normalisation —
  title (×3.4), tags (×2.2), body (×1.0) — then bonuses for query coverage,
  exact-title match, recency and pinning.
- **Query operators**: `tag:work/clients` (matches nested tags), `is:todo`,
  `is:pinned`, `is:orphan`, `in:archive`, `"exact phrase"`, `-excluded`,
  `updated:>2026-01-01`.
- **Highlighted results.** Matches are marked in both the title and the excerpt,
  and the excerpt is a window centred on the densest cluster of matches — so a
  fuzzy hit never looks like a random guess.

### Performance

Search must complete inside a frame while you type. Measured on this machine
with a Zipf-sampled 8,000-word vocabulary (`npm run bench`):

| Notes | Index build | p50 | p95 |
|---:|---:|---:|---:|
| 200 | 219 ms | 10.3 ms | 20.3 ms |
| 1,000 | 798 ms | 13.9 ms | 26.1 ms |
| 5,000 | 2.6 s | 20.6 ms | 42.5 ms |
| 20,000 | 12.7 s | 48.1 ms | 112.3 ms |

Two things made this workable and are worth knowing about:

- **Phrase queries were 16× slower than everything else** (839 ms at 5,000
  notes) because verifying adjacency re-tokenised every candidate note,
  allocating hundreds of objects each. Compiling the phrase to a regex and
  testing it against the raw string dropped it to 55 ms.
- **Saving a note does not rebuild the index.** `upsertDoc` tombstones the old
  entry and appends a new one, so an edit costs the size of one note rather than
  the size of the library.

---

## Durability

The order of operations in `save()` is deliberate:

1. Append the new revision to `versions/{id}.jsonl`.
2. Write `notes/{id}.md.tmp`, then rename it over `notes/{id}.md`.

History is written **first**, so if the process dies between the two steps the
new text is already durable and the next load recovers it. The reverse order
could lose the only copy. Appending never rewrites existing bytes, so a crash
can only ever damage the final line of the log — which the reader drops, leaving
all earlier history physically untouchable.

Parsing never throws. A note file with a mangled header still yields its text,
because losing formatting is recoverable and losing writing is not.

All of this is tested against a fake filesystem that can fail on demand — see
`scripts/test-store.mjs` for the truncated-log, destroyed-file and
no-rename-support cases.

---

## Everything else

- **Markdown editor** with live rendering. Tap any line in the rendered view and
  the cursor lands on that character. Lists continue themselves; Return on an
  empty item ends the list. Checkboxes are tappable without entering edit mode.
- **`[[Wikilinks]]`** with autocomplete, automatic backlinks, and a
  force-directed connections graph. Links to notes that do not exist yet become
  an invitation to write them.
- **Nested tags** (`#work/clients/acme`) with a tag tree and cumulative counts.
- **Version history** with previews, word-count deltas, and one-tap restore —
  and because a restore is itself just another revision, restoring can never
  destroy anything either.
- **Face ID lock** per note, **pin**, **archive**, **30-day trash**.
- Light and dark themes, six accents, four text sizes, three writing fonts.

---

## Layout

```
src/core/            pure TypeScript, no React, fully tested
  search/            tokenizer, fuzzy matcher, query parser, BM25F engine
  store/             on-disk format, durability, history
  markdown.ts        block + inline parser, editor behaviours
  links.ts           tags, wikilinks, backlink graph, tag tree
  layout.ts          force-directed graph layout
src/platform/        filesystem adapters (Expo native, browser)
src/state/           the library hook: notes + index + graph + persistence
src/ui/              screens and components
```

## Development

```bash
npm test
```

```bash
npm run bench
```

```bash
npx expo start --web
```

430 assertions across six suites. The `editDistance` implementation is verified
against a brute-force reference on 160,000 random string pairs.

## License

MIT
