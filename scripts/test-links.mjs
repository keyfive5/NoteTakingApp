// Tag and wikilink graph tests.
import { describe, eq, ok, report } from './harness.mjs';
import {
  buildGraph, buildTagTree, extractLinkKeys, extractLinks, extractTags, linkKey,
} from '../src/core/links.ts';
import { emptyNote } from '../src/core/types.ts';

const T0 = Date.UTC(2026, 7, 20);
let seq = 0;
function mk(title, body, extra = {}) {
  const n = emptyNote('n' + ++seq, T0);
  n.title = title;
  n.body = body;
  n.tags = extractTags(body);
  n.links = extractLinkKeys(body);
  return Object.assign(n, extra);
}

describe('extractTags', () => {
  eq(extractTags('a #work b'), ['work'], 'simple tag');
  eq(extractTags('#work/clients/acme'), ['work/clients/acme'], 'nested tag');
  eq(extractTags('#a #b #a'), ['a', 'b'], 'deduplicates');
  eq(extractTags('#Work'), ['work'], 'lowercased');
  eq(extractTags('#Café'), ['cafe'], 'folded');
  eq(extractTags('no tags here'), [], 'none');
  eq(extractTags('#123'), [], 'numeric-only is not a tag');
  eq(extractTags('C# and F#'), [], 'trailing hash is not a tag');
  eq(extractTags('(#paren)'), ['paren'], 'after an opening bracket');
  eq(extractTags('#trail/'), ['trail'], 'trailing slash trimmed');
  eq(extractTags('email me@x.com #real'), ['real'], 'ignores non-tag text');
});

describe('tags are not parsed inside code', () => {
  eq(extractTags('`#nottag`'), [], 'inline code');
  eq(extractTags('```\n#nottag\n```'), [], 'fenced code');
  eq(extractTags('```\n#nope\n```\n#yes'), ['yes'], 'resumes after the fence');
  eq(extractTags('`#no` and #yes'), ['yes'], 'mixed on one line');
  eq(extractTags('```\nunclosed #no'), [], 'unterminated fence swallows to the end');
});

describe('extractLinks', () => {
  const links = extractLinks('see [[My Note]] and [[Other|alias]]');
  eq(links.length, 2, 'two links');
  eq(links[0].target, 'My Note', 'raw target');
  eq(links[0].key, 'my note', 'normalised key');
  eq(links[0].label, 'My Note', 'label defaults to the target');
  eq(links[1].label, 'alias', 'alias used as the label');
  eq(links[1].key, 'other', 'alias does not change the target');
  eq('see [[My Note]] and [[Other|alias]]'.slice(links[0].start, links[0].end), '[[My Note]]', 'offsets are exact');

  eq(extractLinkKeys('[[A]] [[a]] [[ A ]]'), ['a'], 'keys deduplicate case and spacing');
  eq(extractLinkKeys('[[]]'), [], 'empty link ignored');
  eq(extractLinkKeys('[[unclosed'), [], 'unterminated link ignored');
  eq(extractLinkKeys('`[[incode]]`'), [], 'not parsed inside code');
  eq(linkKey('  Multi   Word  '), 'multi word', 'key collapses whitespace');
});

describe('graph', () => {
  const notes = [
    mk('Alpha', 'links to [[Beta]] and [[Gamma]]'),
    mk('Beta', 'links back to [[Alpha]]'),
    mk('Gamma', 'no outgoing links'),
    mk('Delta', 'points at [[Nowhere]]'),
  ];
  const g = buildGraph(notes);
  const id = (t) => notes.find((n) => n.title === t).id;

  eq(g.outgoing.get(id('Alpha')).length, 2, 'Alpha has two outgoing');
  eq(g.outgoing.get(id('Gamma')), [], 'Gamma has none');
  eq(g.incoming.get(id('Beta')), [id('Alpha')], 'Beta is linked from Alpha');
  eq(g.incoming.get(id('Alpha')), [id('Beta')], 'reciprocal link');
  eq(g.incoming.get(id('Delta')), undefined, 'Delta has no backlinks');

  eq([...g.unresolved.keys()], ['nowhere'], 'unresolved target recorded');
  eq(g.unresolved.get('nowhere').from, [id('Delta')], 'and who wants it');

  const counts = g.backlinkCounts();
  eq(counts.get(id('Beta')), 1, 'backlink count');
  eq(counts.get(id('Gamma')), 1, 'Gamma is linked from Alpha');
  eq(counts.get(id('Delta')), undefined, 'no entry for a note nothing links to');
  eq(g.edges().length, 3, 'three resolved edges');
});

describe('graph edge cases', () => {
  const selfRef = [mk('Solo', 'links to [[Solo]] itself')];
  const g1 = buildGraph(selfRef);
  eq(g1.outgoing.get(selfRef[0].id), [], 'self links are not edges');
  eq(g1.incoming.size, 0, 'and create no backlink');

  const dupes = [mk('Same', 'first'), mk('Same', 'second'), mk('Ptr', 'to [[Same]]')];
  const g2 = buildGraph(dupes);
  eq(g2.incoming.get(dupes[0].id), [dupes[2].id], 'first note with a title claims the link');
  eq(g2.incoming.get(dupes[1].id), undefined, 'the duplicate does not also receive it');

  const trashed = [mk('Live', 'to [[Dead]]'), mk('Dead', 'gone', { trashedAt: T0 })];
  const g3 = buildGraph(trashed);
  eq(g3.outgoing.get(trashed[0].id), [], 'links to trashed notes do not resolve');
  eq([...g3.unresolved.keys()], ['dead'], 'and become unresolved instead');

  const repeated = [mk('A', 'to [[B]] and again [[B]]'), mk('B', 'x')];
  const g4 = buildGraph(repeated);
  eq(g4.outgoing.get(repeated[0].id).length, 1, 'repeated link counts once');
  eq(g4.incoming.get(repeated[1].id).length, 1, 'and yields one backlink');

  eq(buildGraph([]).edges(), [], 'empty graph');
});

describe('tag tree', () => {
  const notes = [
    mk('a', '#work/clients/acme'),
    mk('b', '#work/clients/beta'),
    mk('c', '#work/planning'),
    mk('d', '#home'),
    mk('e', '#home #work'),
  ];
  const tree = buildTagTree(notes);
  const work = tree.find((t) => t.path === 'work');
  const home = tree.find((t) => t.path === 'home');

  eq(work.count, 4, 'parent counts every descendant note');
  eq(home.count, 2, 'sibling count');
  eq(work.children.map((c) => c.path).sort(), ['work/clients', 'work/planning'], 'children');
  const clients = work.children.find((c) => c.path === 'work/clients');
  eq(clients.count, 2, 'nested count');
  eq(clients.children.length, 2, 'leaf nodes');
  eq(clients.children[0].name, 'acme', 'leaf name is the last segment only');
  eq(tree[0].path, 'work', 'sorted by count');

  // A note with two tags under one parent must only count once for that parent.
  const once = buildTagTree([mk('x', '#p/a #p/b')]);
  eq(once[0].count, 1, 'a note counts once per ancestor');
  eq(buildTagTree([]), [], 'no tags');
  eq(buildTagTree([mk('t', 'no tags')]), [], 'notes without tags');
  eq(buildTagTree([mk('t', '#gone', { trashedAt: T0 })]), [], 'trashed notes excluded');
});

report('links');
