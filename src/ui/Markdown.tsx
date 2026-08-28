// Rendered Markdown.
//
// This is the reading surface. Tapping anywhere in it opens the editor with the
// cursor on the character that was tapped, which is what makes the app feel like
// a live editor without any of the fragility of styling text inside a TextInput.
// Checkboxes and links are tappable in place, so the common actions never
// require entering edit mode at all.

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Block, Span } from '../core/markdown.ts';
import { parseBlocks } from '../core/markdown.ts';
import type { Palette } from './theme.ts';
import { radius, space } from './theme.ts';

export interface MarkdownProps {
  source: string;
  palette: Palette;
  fontScale: number;
  fontFamily?: string;
  /** Tap on a checkbox; receives the source offset of that line. */
  onToggleTask?: (offset: number) => void;
  /** Tap on body text; receives the source offset to place the cursor at. */
  onTapAt?: (offset: number) => void;
  onOpenWiki?: (key: string, target: string) => void;
  onOpenTag?: (tag: string) => void;
  /** Wikilink targets that do not resolve to a note yet, shown as invitations. */
  unresolved?: Set<string>;
}

export function Markdown({
  source,
  palette,
  fontScale,
  fontFamily,
  onToggleTask,
  onTapAt,
  onOpenWiki,
  onOpenTag,
  unresolved,
}: MarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  const s = React.useMemo(() => sheet(palette, fontScale, fontFamily), [palette, fontScale, fontFamily]);

  return (
    <View>
      {blocks.map((block, i) => (
        <BlockView
          key={`${block.start}-${i}`}
          block={block}
          next={blocks[i + 1]}
          s={s}
          palette={palette}
          fontScale={fontScale}
          onToggleTask={onToggleTask}
          onTapAt={onTapAt}
          onOpenWiki={onOpenWiki}
          onOpenTag={onOpenTag}
          unresolved={unresolved}
        />
      ))}
    </View>
  );
}

function BlockView({
  block,
  next,
  s,
  palette,
  fontScale,
  onToggleTask,
  onTapAt,
  onOpenWiki,
  onOpenTag,
  unresolved,
}: {
  block: Block;
  next?: Block;
  s: ReturnType<typeof sheet>;
  palette: Palette;
  fontScale: number;
  onToggleTask?: (offset: number) => void;
  onTapAt?: (offset: number) => void;
  onOpenWiki?: (key: string, target: string) => void;
  onOpenTag?: (tag: string) => void;
  unresolved?: Set<string>;
}) {
  const tap = () => onTapAt?.(block.start);
  const inline = (spans: Span[], extra?: object) => (
    <Inline
      spans={spans}
      s={s}
      palette={palette}
      onOpenWiki={onOpenWiki}
      onOpenTag={onOpenTag}
      unresolved={unresolved}
      style={extra}
    />
  );

  switch (block.kind) {
    case 'heading': {
      const style = block.level === 1 ? s.h1 : block.level === 2 ? s.h2 : s.h3;
      return (
        <Pressable onPress={tap}>
          <Text style={style}>{inline(block.spans)}</Text>
        </Pressable>
      );
    }
    case 'paragraph':
      return (
        <Pressable onPress={tap}>
          <Text style={s.p}>{inline(block.spans)}</Text>
        </Pressable>
      );
    case 'bullet':
      return (
        <Pressable onPress={tap} style={[s.row, { paddingLeft: block.depth * space(5) }]}>
          <Text style={s.bulletMark}>{block.depth % 2 === 0 ? '•' : '◦'}</Text>
          <Text style={[s.p, s.rowText]}>{inline(block.spans)}</Text>
        </Pressable>
      );
    case 'numbered':
      return (
        <Pressable onPress={tap} style={[s.row, { paddingLeft: block.depth * space(5) }]}>
          <Text style={s.numberMark}>{block.label}.</Text>
          <Text style={[s.p, s.rowText]}>{inline(block.spans)}</Text>
        </Pressable>
      );
    case 'task':
      return (
        <View style={[s.row, { paddingLeft: block.depth * space(5) }]}>
          <Pressable
            onPress={() => onToggleTask?.(block.start)}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: block.checked }}
            style={[s.checkbox, block.checked && s.checkboxOn]}
          >
            {block.checked ? <Text style={s.checkmark}>✓</Text> : null}
          </Pressable>
          <Pressable onPress={tap} style={s.grow}>
            <Text style={[s.p, s.rowText, block.checked && s.done]}>{inline(block.spans)}</Text>
          </Pressable>
        </View>
      );
    case 'quote':
      return (
        <Pressable onPress={tap} style={s.quote}>
          <Text style={[s.p, s.quoteText]}>{inline(block.spans)}</Text>
        </Pressable>
      );
    case 'code':
      return (
        <Pressable onPress={tap} style={s.code}>
          {block.lang ? <Text style={s.codeLang}>{block.lang}</Text> : null}
          <Text style={s.codeText}>{block.text}</Text>
        </Pressable>
      );
    case 'divider':
      return (
        <Pressable onPress={tap} style={s.dividerHit}>
          <View style={s.divider} />
        </Pressable>
      );
    case 'blank':
      // Collapse runs of blank lines into one modest gap, but keep the tap
      // target so the end of a note is still reachable.
      return next?.kind === 'blank' ? null : (
        <Pressable onPress={tap} style={s.blank} />
      );
  }
}

function Inline({
  spans,
  s,
  palette,
  onOpenWiki,
  onOpenTag,
  unresolved,
  style,
}: {
  spans: Span[];
  s: ReturnType<typeof sheet>;
  palette: Palette;
  onOpenWiki?: (key: string, target: string) => void;
  onOpenTag?: (tag: string) => void;
  unresolved?: Set<string>;
  style?: object;
}) {
  return (
    <>
      {spans.map((span, i) => {
        const parts = [style];
        if (span.bold) parts.push(s.bold);
        if (span.italic) parts.push(s.italic);
        if (span.strike) parts.push(s.strike);
        if (span.highlight) parts.push(s.highlight);
        if (span.code) parts.push(s.inlineCode);

        if (span.wikiKey !== undefined) {
          const missing = unresolved?.has(span.wikiKey);
          return (
            <Text
              key={i}
              style={[...parts, s.wiki, missing && s.wikiMissing]}
              onPress={() => onOpenWiki?.(span.wikiKey!, span.wikiTarget ?? span.text)}
              suppressHighlighting
            >
              {span.text}
            </Text>
          );
        }
        if (span.tag !== undefined) {
          return (
            <Text key={i} style={[...parts, s.tag]} onPress={() => onOpenTag?.(span.tag!)} suppressHighlighting>
              {span.text}
            </Text>
          );
        }
        if (span.href !== undefined) {
          return (
            <Text
              key={i}
              style={[...parts, s.link]}
              onPress={() => {
                void Linking.openURL(span.href!).catch(() => {});
              }}
              suppressHighlighting
            >
              {span.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={parts}>
            {span.text}
          </Text>
        );
      })}
    </>
  );
}

function sheet(p: Palette, scale: number, fontFamily?: string) {
  const base = 17 * scale;
  const body = { fontSize: base, lineHeight: base * 1.55, color: p.text, fontFamily };
  return StyleSheet.create({
    p: { ...body, marginBottom: space(1) },
    h1: {
      fontSize: base * 1.55,
      lineHeight: base * 1.9,
      fontWeight: '700',
      color: p.text,
      marginTop: space(3),
      marginBottom: space(1.5),
      letterSpacing: -0.5,
      fontFamily,
    },
    h2: {
      fontSize: base * 1.28,
      lineHeight: base * 1.65,
      fontWeight: '700',
      color: p.text,
      marginTop: space(3),
      marginBottom: space(1),
      letterSpacing: -0.3,
      fontFamily,
    },
    h3: {
      fontSize: base * 1.08,
      lineHeight: base * 1.5,
      fontWeight: '600',
      color: p.textDim,
      marginTop: space(2.5),
      marginBottom: space(1),
      fontFamily,
    },
    row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space(1) },
    rowText: { flex: 1, marginBottom: 0 },
    grow: { flex: 1 },
    bulletMark: {
      width: space(6),
      color: p.accent,
      fontSize: base,
      lineHeight: base * 1.55,
      textAlign: 'center',
    },
    numberMark: {
      minWidth: space(6),
      color: p.accent,
      fontSize: base * 0.92,
      lineHeight: base * 1.55,
      textAlign: 'right',
      paddingRight: space(1.5),
      fontVariant: ['tabular-nums'],
    },
    checkbox: {
      width: 21,
      height: 21,
      borderRadius: 6,
      borderWidth: 1.6,
      borderColor: p.borderStrong,
      marginRight: space(2.5),
      marginLeft: space(0.5),
      marginTop: base * 0.28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: p.accent, borderColor: p.accent },
    checkmark: { color: p.accentText, fontSize: 13, fontWeight: '900', lineHeight: 16 },
    done: { color: p.textFaint, textDecorationLine: 'line-through' },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: p.accent,
      paddingLeft: space(3),
      marginVertical: space(1),
    },
    quoteText: { color: p.textDim, fontStyle: 'italic' },
    code: {
      backgroundColor: p.surfaceAlt,
      borderRadius: radius.md,
      padding: space(3),
      marginVertical: space(1.5),
      borderWidth: 1,
      borderColor: p.border,
    },
    codeLang: {
      color: p.textFaint,
      fontSize: 11,
      fontWeight: '600',
      marginBottom: space(1),
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    codeText: { fontFamily: 'Menlo', fontSize: base * 0.85, lineHeight: base * 1.35, color: p.text },
    inlineCode: {
      fontFamily: 'Menlo',
      fontSize: base * 0.88,
      backgroundColor: p.surfaceAlt,
      color: p.accent,
    },
    dividerHit: { paddingVertical: space(2.5) },
    divider: { height: 1, backgroundColor: p.border },
    blank: { height: base * 0.7 },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through', color: p.textDim },
    highlight: { backgroundColor: p.highlight, color: p.text },
    link: { color: p.accent, textDecorationLine: 'underline' },
    wiki: { color: p.accent, fontWeight: '600' },
    wikiMissing: { color: p.textDim, textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
    tag: { color: p.accent, fontWeight: '600' },
  });
}
