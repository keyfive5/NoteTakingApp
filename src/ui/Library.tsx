// The library screen: search, filters, and the note list.
//
// Search is the top of the screen rather than hidden behind a pull-down,
// because finding a note you half-remember is the thing this app is for. Results
// update on every keystroke and show *why* they matched — the matching words are
// marked in both the title and the excerpt — so a fuzzy hit never feels random.

import React from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import type { Highlight, SearchResult } from '../core/search/engine.ts';
import type { Note } from '../core/types.ts';
import type { TagNode } from '../core/links.ts';
import { Icon } from './Icon.tsx';
import { relativeTime, radius, space, type Palette } from './theme.ts';

export type Scope = 'active' | 'archive' | 'trash' | 'all';

/** Text with search matches marked. */
export function Marked({
  text,
  ranges,
  style,
  markStyle,
  numberOfLines,
}: {
  text: string;
  ranges: Highlight[];
  style?: object;
  markStyle?: object;
  numberOfLines?: number;
}) {
  if (ranges.length === 0) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) parts.push(<Text key={`p${i}`}>{text.slice(at, r.start)}</Text>);
    parts.push(
      <Text key={`m${i}`} style={markStyle}>
        {text.slice(r.start, r.end)}
      </Text>,
    );
    at = r.end;
  });
  if (at < text.length) parts.push(<Text key="tail">{text.slice(at)}</Text>);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts}
    </Text>
  );
}

function NoteRow({
  note,
  result,
  p,
  s,
  onPress,
  onLongPress,
}: {
  note: Note;
  result: SearchResult;
  p: Palette;
  s: ReturnType<typeof sheet>;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const title = note.title.trim() || 'Untitled';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${result.snippet}`}
    >
      <View style={s.rowHead}>
        <Marked
          text={title}
          ranges={note.title.trim() ? result.titleHighlights : []}
          style={[s.rowTitle, !note.title.trim() && s.untitled]}
          markStyle={s.mark}
          numberOfLines={1}
        />
        {note.locked ? <Icon name="lock" size={13} color={p.textFaint} /> : null}
        {note.pinned ? <Icon name="pinned" size={13} color={p.accent} /> : null}
        <Text style={s.rowTime}>{relativeTime(note.updatedAt)}</Text>
      </View>

      {note.locked ? (
        <Text style={s.lockedNote}>Locked · unlock to read</Text>
      ) : result.snippet ? (
        <Marked
          text={result.snippet}
          ranges={result.snippetHighlights}
          style={s.rowSnippet}
          markStyle={s.mark}
          numberOfLines={2}
        />
      ) : (
        <Text style={[s.rowSnippet, s.untitled]}>No additional text</Text>
      )}

      {note.tags.length > 0 ? (
        <View style={s.rowTags}>
          {note.tags.slice(0, 4).map((t) => (
            <Text key={t} style={s.rowTag}>
              #{t}
            </Text>
          ))}
          {note.tags.length > 4 ? <Text style={s.rowTagMore}>+{note.tags.length - 4}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function Library({
  palette: p,
  ready,
  query,
  onQueryChange,
  results,
  notes,
  scope,
  onScopeChange,
  activeTag,
  onTagChange,
  tags,
  counts,
  recoveredCount,
  onOpen,
  onLongPress,
  onNew,
  onOpenSettings,
  onOpenGraph,
  onEmptyTrash,
}: {
  palette: Palette;
  ready: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  notes: Map<string, Note>;
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  activeTag: string | null;
  onTagChange: (t: string | null) => void;
  tags: TagNode[];
  counts: { active: number; archived: number; trashed: number };
  recoveredCount: number;
  onOpen: (id: string) => void;
  onLongPress: (id: string) => void;
  onNew: () => void;
  onOpenSettings: () => void;
  onOpenGraph: () => void;
  onEmptyTrash: () => void;
}) {
  const s = React.useMemo(() => sheet(p), [p]);
  const inputRef = React.useRef<TextInput>(null);
  const searching = query.trim().length > 0;

  const scopes: { key: Scope; label: string; count: number }[] = [
    { key: 'active', label: 'Notes', count: counts.active },
    { key: 'archive', label: 'Archive', count: counts.archived },
    { key: 'trash', label: 'Trash', count: counts.trashed },
  ];

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.wordmark}>Sift</Text>
          <View style={s.headerActions}>
            <Pressable onPress={onOpenGraph} hitSlop={10} style={s.iconBtn} accessibilityLabel="Connections">
              <Icon name="graph" size={20} color={p.textDim} />
            </Pressable>
            <Pressable onPress={onOpenSettings} hitSlop={10} style={s.iconBtn} accessibilityLabel="Settings">
              <Icon name="settings" size={20} color={p.textDim} />
            </Pressable>
          </View>
        </View>

        <View style={s.searchWrap}>
          <Icon name="search" size={18} color={searching ? p.accent : p.textFaint} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search everything"
            placeholderTextColor={p.textFaint}
            style={s.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="never"
            accessibilityLabel="Search notes"
          />
          {searching ? (
            <Pressable
              onPress={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              hitSlop={12}
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={17} color={p.textDim} />
            </Pressable>
          ) : null}
        </View>

        <View style={s.chips}>
          {scopes.map((sc) => (
            <Pressable
              key={sc.key}
              onPress={() => onScopeChange(sc.key)}
              style={[s.chip, scope === sc.key && s.chipOn]}
            >
              <Text style={[s.chipText, scope === sc.key && s.chipTextOn]}>{sc.label}</Text>
              {sc.count > 0 ? (
                <Text style={[s.chipCount, scope === sc.key && s.chipTextOn]}>{sc.count}</Text>
              ) : null}
            </Pressable>
          ))}
          {activeTag ? (
            <Pressable onPress={() => onTagChange(null)} style={[s.chip, s.chipTag]}>
              <Text style={[s.chipText, s.chipTagText]}>#{activeTag}</Text>
              <Icon name="close" size={13} color={p.accent} />
            </Pressable>
          ) : null}
        </View>

        {!activeTag && !searching && tags.length > 0 ? (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={tags.slice(0, 12)}
            keyExtractor={(t) => t.path}
            contentContainerStyle={s.tagRail}
            renderItem={({ item }) => (
              <Pressable onPress={() => onTagChange(item.path)} style={s.tagPill}>
                <Text style={s.tagPillText}>#{item.path}</Text>
                <Text style={s.tagPillCount}>{item.count}</Text>
              </Pressable>
            )}
          />
        ) : null}
      </View>

      {recoveredCount > 0 ? (
        <View style={s.banner}>
          <Icon name="restore" size={16} color={p.success} />
          <Text style={s.bannerText}>
            {recoveredCount === 1
              ? 'Recovered 1 note from its history after a damaged file.'
              : `Recovered ${recoveredCount} notes from history after damaged files.`}
          </Text>
        </View>
      ) : null}

      {!ready ? (
        <View style={s.empty}>
          <ActivityIndicator color={p.accent} />
        </View>
      ) : results.length === 0 ? (
        <EmptyState p={p} s={s} searching={searching} scope={scope} query={query} onNew={onNew} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={12}
          windowSize={9}
          removeClippedSubviews={Platform.OS !== 'web'}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          renderItem={({ item }) => {
            const note = notes.get(item.id);
            if (!note) return null;
            return (
              <NoteRow
                note={note}
                result={item}
                p={p}
                s={s}
                onPress={() => {
                  Keyboard.dismiss();
                  onOpen(item.id);
                }}
                onLongPress={() => onLongPress(item.id)}
              />
            );
          }}
          ListFooterComponent={
            scope === 'trash' && results.length > 0 ? (
              <Pressable onPress={onEmptyTrash} style={s.emptyTrashBtn}>
                <Icon name="trash" size={16} color={p.danger} />
                <Text style={s.emptyTrashText}>Empty trash</Text>
              </Pressable>
            ) : (
              <View style={s.footerPad} />
            )
          }
        />
      )}

      <Pressable
        onPress={onNew}
        style={({ pressed }) => [s.fab, pressed && s.fabPressed]}
        accessibilityLabel="New note"
        accessibilityRole="button"
      >
        <Icon name="plus" size={26} color={p.accentText} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

function EmptyState({
  p,
  s,
  searching,
  scope,
  query,
  onNew,
}: {
  p: Palette;
  s: ReturnType<typeof sheet>;
  searching: boolean;
  scope: Scope;
  query: string;
  onNew: () => void;
}) {
  if (searching) {
    return (
      <View style={s.empty}>
        <Icon name="search" size={30} color={p.textFaint} />
        <Text style={s.emptyTitle}>Nothing matches “{query.trim()}”</Text>
        <Text style={s.emptyBody}>
          Sift already tried close spellings, word endings and split compounds. Try fewer words.
        </Text>
      </View>
    );
  }
  if (scope === 'trash') {
    return (
      <View style={s.empty}>
        <Icon name="trash" size={30} color={p.textFaint} />
        <Text style={s.emptyTitle}>Trash is empty</Text>
        <Text style={s.emptyBody}>Deleted notes wait here for 30 days before they are removed.</Text>
      </View>
    );
  }
  if (scope === 'archive') {
    return (
      <View style={s.empty}>
        <Icon name="archive" size={30} color={p.textFaint} />
        <Text style={s.emptyTitle}>Nothing archived</Text>
        <Text style={s.emptyBody}>Archive keeps finished notes out of the way without deleting them.</Text>
      </View>
    );
  }
  return (
    <View style={s.empty}>
      <Icon name="note" size={30} color={p.textFaint} />
      <Text style={s.emptyTitle}>Start writing</Text>
      <Text style={s.emptyBody}>
        Every note is a Markdown file on this device. No account, no sync to break, nothing to pay for.
      </Text>
      <Pressable onPress={onNew} style={s.emptyBtn}>
        <Text style={s.emptyBtnText}>New note</Text>
      </Pressable>
    </View>
  );
}

function sheet(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    header: {
      paddingHorizontal: space(4),
      paddingBottom: space(2),
      backgroundColor: p.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    wordmark: { fontSize: 30, fontWeight: '800', color: p.text, letterSpacing: -0.9 },
    headerActions: { flexDirection: 'row', gap: space(1) },
    iconBtn: { padding: space(2) },

    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(2.5),
      backgroundColor: p.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: space(3.5),
      height: 46,
      marginTop: space(2),
      borderWidth: 1,
      borderColor: p.border,
    },
    searchInput: {
      flex: 1,
      fontSize: 17,
      color: p.text,
      padding: 0,
      // Removes the focus ring react-native-web adds to inputs.
      ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
    },

    chips: { flexDirection: 'row', gap: space(2), marginTop: space(2.5), flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(1.5),
      paddingHorizontal: space(3),
      paddingVertical: space(1.5),
      borderRadius: radius.pill,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
    },
    chipOn: { backgroundColor: p.text, borderColor: p.text },
    chipTag: { backgroundColor: p.accentSoft, borderColor: p.accent },
    chipText: { fontSize: 13.5, fontWeight: '600', color: p.textDim },
    chipTextOn: { color: p.bg },
    chipTagText: { color: p.accent },
    chipCount: { fontSize: 12, fontWeight: '600', color: p.textFaint },

    tagRail: { gap: space(2), paddingTop: space(2.5), paddingRight: space(4) },
    tagPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(1.5),
      paddingHorizontal: space(2.5),
      paddingVertical: space(1),
      borderRadius: radius.sm,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
    },
    tagPillText: { fontSize: 12.5, color: p.textDim, fontWeight: '600' },
    tagPillCount: { fontSize: 11, color: p.textFaint, fontWeight: '700' },

    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(2),
      marginHorizontal: space(4),
      marginTop: space(3),
      padding: space(3),
      borderRadius: radius.md,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
    },
    bannerText: { flex: 1, fontSize: 13, color: p.textDim, lineHeight: 18 },

    list: { paddingBottom: space(28) },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginLeft: space(4) },
    row: { paddingHorizontal: space(4), paddingVertical: space(3.5) },
    rowPressed: { backgroundColor: p.surfaceAlt },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
    rowTitle: { flex: 1, fontSize: 16.5, fontWeight: '600', color: p.text, letterSpacing: -0.2 },
    untitled: { color: p.textFaint, fontStyle: 'italic' },
    rowTime: { fontSize: 12, color: p.textFaint, fontVariant: ['tabular-nums'] },
    rowSnippet: { fontSize: 14.5, color: p.textDim, lineHeight: 20, marginTop: space(1) },
    lockedNote: { fontSize: 14, color: p.textFaint, marginTop: space(1), fontStyle: 'italic' },
    mark: { backgroundColor: p.mark, color: p.text, fontWeight: '700' },
    rowTags: { flexDirection: 'row', gap: space(2), marginTop: space(1.5), flexWrap: 'wrap' },
    rowTag: { fontSize: 12, color: p.accent, fontWeight: '600' },
    rowTagMore: { fontSize: 12, color: p.textFaint, fontWeight: '600' },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8), gap: space(2) },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: p.text, marginTop: space(2), textAlign: 'center' },
    emptyBody: { fontSize: 14.5, color: p.textDim, textAlign: 'center', lineHeight: 21, maxWidth: 320 },
    emptyBtn: {
      marginTop: space(3),
      paddingHorizontal: space(6),
      paddingVertical: space(3),
      borderRadius: radius.pill,
      backgroundColor: p.accent,
    },
    emptyBtnText: { color: p.accentText, fontWeight: '700', fontSize: 15 },
    emptyTrashBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space(2),
      margin: space(4),
      padding: space(3.5),
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: p.border,
    },
    emptyTrashText: { color: p.danger, fontWeight: '600', fontSize: 15 },
    footerPad: { height: space(6) },

    fab: {
      position: 'absolute',
      right: space(5),
      bottom: space(8),
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: p.dark ? 0.5 : 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    fabPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  });
}
