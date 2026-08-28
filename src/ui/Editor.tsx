// The editor.
//
// Two surfaces over one string. Unfocused, the note renders as formatted
// Markdown; tapping any line focuses a plain TextInput with the cursor on the
// character that was tapped. That split is deliberate: styling text *inside* a
// React Native TextInput is possible but fights the cursor, and a note app that
// occasionally eats a keystroke is worthless. This way the reading view can be
// as rich as it likes while the writing surface stays boringly reliable.
//
// On top of that sit the behaviours that make Markdown feel native rather than
// like editing a text file: lists continue themselves, Return on an empty item
// ends the list, and a toolbar above the keyboard applies formatting to the
// selection.

import React from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import {
  activeToken, continueList, deriveTitle, shiftIndent, toggleInline,
  toggleLinePrefix, toggleTask, type LinePrefix,
} from '../core/markdown.ts';
import { readingMinutes, wordCount, type Note } from '../core/types.ts';
import { Icon, type IconName } from './Icon.tsx';
import { Markdown } from './Markdown.tsx';
import { FONTS, fullTime, radius, space, type Palette } from './theme.ts';

interface Selection {
  start: number;
  end: number;
}

const TOOLS: { icon: IconName; label: string; kind: 'prefix' | 'inline' | 'indent'; value: string }[] = [
  { icon: 'checklist', label: 'Checklist', kind: 'prefix', value: 'task' },
  { icon: 'bullet', label: 'Bullet list', kind: 'prefix', value: 'bullet' },
  { icon: 'numbered', label: 'Numbered list', kind: 'prefix', value: 'numbered' },
  { icon: 'heading', label: 'Heading', kind: 'prefix', value: 'h2' },
  { icon: 'bold', label: 'Bold', kind: 'inline', value: '**' },
  { icon: 'italic', label: 'Italic', kind: 'inline', value: '_' },
  { icon: 'highlight', label: 'Highlight', kind: 'inline', value: '==' },
  { icon: 'strike', label: 'Strikethrough', kind: 'inline', value: '~~' },
  { icon: 'code', label: 'Code', kind: 'inline', value: '`' },
  { icon: 'quote', label: 'Quote', kind: 'prefix', value: 'quote' },
  { icon: 'link', label: 'Link a note', kind: 'inline', value: '[[' },
  { icon: 'indent', label: 'Indent', kind: 'indent', value: '1' },
  { icon: 'outdent', label: 'Outdent', kind: 'indent', value: '-1' },
];

export function Editor({
  note,
  palette: p,
  fontScale,
  editorFont,
  backlinks,
  unresolved,
  suggestions,
  onChangeBody,
  onBack,
  onTogglePin,
  onToggleArchive,
  onToggleLock,
  onTrash,
  onRestore,
  onDestroy,
  onShare,
  onOpenHistory,
  onOpenWiki,
  onOpenTag,
  onRequestSuggestions,
}: {
  note: Note;
  palette: Palette;
  fontScale: number;
  editorFont: 'sans' | 'serif' | 'mono';
  backlinks: Note[];
  unresolved: Set<string>;
  suggestions: Note[];
  onChangeBody: (body: string) => void;
  onBack: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onToggleLock: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDestroy: () => void;
  onShare: () => void;
  onOpenHistory: () => void;
  onOpenWiki: (key: string, target: string) => void;
  onOpenTag: (tag: string) => void;
  onRequestSuggestions: (query: string) => void;
}) {
  const s = React.useMemo(() => sheet(p), [p]);
  const [editing, setEditing] = React.useState(note.body.trim() === '');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inputRef = React.useRef<TextInput>(null);
  const selection = React.useRef<Selection>({ start: note.body.length, end: note.body.length });
  /** Set when we need to drive the cursor rather than follow it. */
  const [forcedSelection, setForcedSelection] = React.useState<Selection | null>(null);
  const [token, setToken] = React.useState<{ kind: 'wiki' | 'tag'; query: string; start: number } | null>(null);

  const body = note.body;
  const fontFamily = editorFont === 'sans' ? FONTS.sans : editorFont === 'serif' ? FONTS.serif : FONTS.mono;
  const words = React.useMemo(() => wordCount(body), [body]);

  // A forced selection must survive exactly one render, or the cursor becomes
  // impossible to move by hand.
  React.useEffect(() => {
    if (forcedSelection) {
      const t = setTimeout(() => setForcedSelection(null), 60);
      return () => clearTimeout(t);
    }
  }, [forcedSelection]);

  // Tapping a toolbar button blurs the input for an instant. Exiting edit mode
  // on that blur would unmount the TextInput mid-tap, so the exit is deferred
  // and cancelled by any action that means "still editing".
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepEditing = React.useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  }, []);
  React.useEffect(() => keepEditing, [keepEditing]);

  const focusAt = React.useCallback((offset: number) => {
    const at = { start: offset, end: offset };
    selection.current = at;
    setForcedSelection(at);
    setEditing(true);
    // The input has to exist before it can take focus.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const replace = React.useCallback(
    (next: string, sel?: Selection) => {
      onChangeBody(next);
      if (sel) {
        selection.current = sel;
        setForcedSelection(sel);
      }
    },
    [onChangeBody],
  );

  /**
   * Return handling. React Native gives no way to intercept the newline before
   * it lands, so the newline is detected after the fact and rewritten.
   */
  const handleChange = React.useCallback(
    (next: string) => {
      const grew = next.length === body.length + 1;
      const at = selection.current.start;
      if (grew && next[at] === '\n' && next.slice(0, at) === body.slice(0, at)) {
        const cont = continueList(body, at);
        if (cont.remove) {
          // Return on an empty list item ends the list: strip the marker and
          // stay on the now-blank line, rather than adding another empty item.
          const cursor = cont.remove.start;
          replace(body.slice(0, cursor) + body.slice(cont.remove.end), { start: cursor, end: cursor });
          return;
        }
        if (cont.insert !== '\n') {
          const merged = body.slice(0, at) + cont.insert + body.slice(at);
          const cursor = at + cont.insert.length;
          replace(merged, { start: cursor, end: cursor });
          return;
        }
      }
      onChangeBody(next);
    },
    [body, onChangeBody, replace],
  );

  const applyTool = React.useCallback(
    (tool: (typeof TOOLS)[number]) => {
      keepEditing();
      const { start, end } = selection.current;
      if (tool.kind === 'prefix') {
        const r = toggleLinePrefix(body, start, end, tool.value as LinePrefix);
        replace(r.text, { start: r.selection.end, end: r.selection.end });
      } else if (tool.kind === 'indent') {
        const r = shiftIndent(body, start, end, tool.value === '1' ? 1 : -1);
        replace(r.text, { start: r.selection.end, end: r.selection.end });
      } else if (tool.value === '[[') {
        const inserted = body.slice(0, start) + '[[]]' + body.slice(end);
        const cursor = start + 2;
        replace(inserted, { start: cursor, end: cursor });
        setToken({ kind: 'wiki', query: '', start });
        onRequestSuggestions('');
      } else {
        const r = toggleInline(body, start, end, tool.value);
        replace(r.text, r.selection);
      }
      inputRef.current?.focus();
    },
    [body, replace, onRequestSuggestions, keepEditing],
  );

  const acceptSuggestion = React.useCallback(
    (title: string) => {
      keepEditing();
      if (!token) return;
      if (token.kind === 'wiki') {
        const from = token.start;
        // Replace from "[[" through the cursor, and any "]]" already sitting after it.
        let to = selection.current.start;
        if (body.slice(to, to + 2) === ']]') to += 2;
        const next = body.slice(0, from) + `[[${title}]]` + body.slice(to);
        const cursor = from + title.length + 4;
        replace(next, { start: cursor, end: cursor });
      } else {
        const from = token.start;
        const to = selection.current.start;
        const next = body.slice(0, from) + `#${title}` + body.slice(to);
        const cursor = from + title.length + 1;
        replace(next, { start: cursor, end: cursor });
      }
      setToken(null);
      inputRef.current?.focus();
    },
    [body, token, replace, keepEditing],
  );

  const title = deriveTitle(body, 'Untitled');
  const trashed = note.trashedAt !== null;

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={s.bar}>
        <Pressable onPress={onBack} hitSlop={12} style={s.barBtn} accessibilityLabel="Back to notes">
          <Icon name="back" size={22} color={p.text} />
        </Pressable>
        <View style={s.barSpacer} />
        {!trashed ? (
          <>
            <Pressable onPress={onTogglePin} hitSlop={10} style={s.barBtn} accessibilityLabel="Pin note">
              <Icon name={note.pinned ? 'pinned' : 'pin'} size={20} color={note.pinned ? p.accent : p.textDim} />
            </Pressable>
            <Pressable onPress={onOpenHistory} hitSlop={10} style={s.barBtn} accessibilityLabel="Version history">
              <Icon name="history" size={20} color={p.textDim} />
            </Pressable>
            <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={10} style={s.barBtn} accessibilityLabel="More">
              <Icon name="more" size={20} color={p.textDim} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={onRestore} style={s.restoreBtn}>
              <Icon name="restore" size={16} color={p.accentText} />
              <Text style={s.restoreText}>Restore</Text>
            </Pressable>
            <Pressable onPress={onDestroy} hitSlop={10} style={s.barBtn} accessibilityLabel="Delete forever">
              <Icon name="trash" size={20} color={p.danger} />
            </Pressable>
          </>
        )}
      </View>

      {menuOpen ? (
        <>
          <Pressable style={s.scrim} onPress={() => setMenuOpen(false)} />
          <View style={s.menu}>
            <MenuItem
              s={s}
              p={p}
              icon="archive"
              label={note.archived ? 'Move out of archive' : 'Archive'}
              onPress={() => {
                setMenuOpen(false);
                onToggleArchive();
              }}
            />
            <MenuItem
              s={s}
              p={p}
              icon={note.locked ? 'unlock' : 'lock'}
              label={note.locked ? 'Remove lock' : 'Lock with Face ID'}
              onPress={() => {
                setMenuOpen(false);
                onToggleLock();
              }}
            />
            <MenuItem
              s={s}
              p={p}
              icon="share"
              label="Share as Markdown"
              onPress={() => {
                setMenuOpen(false);
                onShare();
              }}
            />
            <MenuItem
              s={s}
              p={p}
              icon="trash"
              label="Move to trash"
              danger
              onPress={() => {
                setMenuOpen(false);
                onTrash();
              }}
            />
          </View>
        </>
      ) : null}

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {editing ? (
          <TextInput
            ref={inputRef}
            value={body}
            onChangeText={handleChange}
            onSelectionChange={(e) => {
              selection.current = e.nativeEvent.selection;
              const t = activeToken(body, e.nativeEvent.selection.start);
              setToken(t);
              if (t) onRequestSuggestions(t.query);
            }}
            selection={forcedSelection ?? undefined}
            onBlur={() => {
              keepEditing();
              blurTimer.current = setTimeout(() => setEditing(false), 140);
            }}
            multiline
            autoFocus={body.trim() === ''}
            scrollEnabled={false}
            textAlignVertical="top"
            placeholder="Start writing…"
            placeholderTextColor={p.textFaint}
            style={[s.input, { fontSize: 17 * fontScale, lineHeight: 17 * fontScale * 1.55, fontFamily }]}
            accessibilityLabel="Note text"
          />
        ) : (
          <Pressable onPress={() => focusAt(body.length)}>
            <Markdown
              source={body}
              palette={p}
              fontScale={fontScale}
              fontFamily={fontFamily}
              unresolved={unresolved}
              onTapAt={focusAt}
              onToggleTask={(offset) => {
                const next = toggleTask(body, offset);
                if (next !== null) onChangeBody(next);
              }}
              onOpenWiki={onOpenWiki}
              onOpenTag={onOpenTag}
            />
            {body.trim() === '' ? <Text style={s.placeholder}>Start writing…</Text> : null}
          </Pressable>
        )}

        <View style={s.meta}>
          <Text style={s.metaText}>
            {words} {words === 1 ? 'word' : 'words'} · {readingMinutes(words)} min read · rev {note.rev}
          </Text>
          <Text style={s.metaText}>Edited {fullTime(note.updatedAt)}</Text>
        </View>

        {backlinks.length > 0 ? (
          <View style={s.backlinks}>
            <View style={s.backlinksHead}>
              <Icon name="link" size={15} color={p.textDim} />
              <Text style={s.backlinksTitle}>
                Linked from {backlinks.length} {backlinks.length === 1 ? 'note' : 'notes'}
              </Text>
            </View>
            {backlinks.map((b) => (
              <Pressable key={b.id} onPress={() => onOpenWiki(b.title.toLowerCase(), b.title)} style={s.backlinkRow}>
                <Text style={s.backlinkTitle} numberOfLines={1}>
                  {b.title.trim() || 'Untitled'}
                </Text>
                <Icon name="chevron" size={15} color={p.textFaint} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {editing && token && suggestions.length > 0 ? (
        <View style={s.suggestions}>
          <Text style={s.suggestionsHead}>{token.kind === 'wiki' ? 'Link to a note' : 'Tags'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
            <View style={s.suggestionRow}>
              {suggestions.map((n) => (
                <Pressable key={n.id} onPress={() => acceptSuggestion(n.title)} style={s.suggestion}>
                  <Text style={s.suggestionText} numberOfLines={1}>
                    {n.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {editing ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={s.toolbar}
          contentContainerStyle={s.toolbarInner}
        >
          {TOOLS.map((tool) => (
            <Pressable
              key={tool.label}
              onPress={() => applyTool(tool)}
              style={s.tool}
              accessibilityLabel={tool.label}
            >
              <Icon name={tool.icon} size={19} color={p.textDim} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function MenuItem({
  s,
  p,
  icon,
  label,
  onPress,
  danger,
}: {
  s: ReturnType<typeof sheet>;
  p: Palette;
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.menuItem, pressed && s.menuItemPressed]}>
      <Icon name={icon} size={18} color={danger ? p.danger : p.textDim} />
      <Text style={[s.menuLabel, danger && { color: p.danger }]}>{label}</Text>
    </Pressable>
  );
}

function sheet(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space(2),
      height: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    barBtn: { padding: space(2.5) },
    barSpacer: { flex: 1 },
    restoreBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(1.5),
      backgroundColor: p.accent,
      paddingHorizontal: space(3.5),
      paddingVertical: space(2),
      borderRadius: radius.pill,
    },
    restoreText: { color: p.accentText, fontWeight: '700', fontSize: 14 },

    scrim: { ...(StyleSheet.absoluteFill as object), zIndex: 5 },
    menu: {
      position: 'absolute',
      right: space(3),
      top: 50,
      zIndex: 6,
      minWidth: 230,
      backgroundColor: p.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: p.border,
      paddingVertical: space(1.5),
      shadowColor: '#000',
      shadowOpacity: p.dark ? 0.5 : 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3) },
    menuItemPressed: { backgroundColor: p.surfaceAlt },
    menuLabel: { fontSize: 15, color: p.text, fontWeight: '500' },

    scroll: { flex: 1 },
    content: { padding: space(5), paddingBottom: space(20) },
    input: {
      color: p.text,
      padding: 0,
      minHeight: 320,
      ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
    },
    placeholder: { color: p.textFaint, fontSize: 17 },

    meta: {
      marginTop: space(8),
      paddingTop: space(3),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      gap: space(0.5),
    },
    metaText: { fontSize: 12, color: p.textFaint },

    backlinks: {
      marginTop: space(5),
      padding: space(3.5),
      borderRadius: radius.md,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
    },
    backlinksHead: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(2) },
    backlinksTitle: { fontSize: 13, fontWeight: '700', color: p.textDim, letterSpacing: 0.2 },
    backlinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space(2),
    },
    backlinkTitle: { flex: 1, fontSize: 15, color: p.text },

    suggestions: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      backgroundColor: p.surface,
      paddingTop: space(2),
      paddingBottom: space(1),
    },
    suggestionsHead: {
      fontSize: 11,
      fontWeight: '700',
      color: p.textFaint,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      paddingHorizontal: space(4),
      marginBottom: space(1.5),
    },
    suggestionRow: { flexDirection: 'row', gap: space(2), paddingHorizontal: space(4), paddingBottom: space(2) },
    suggestion: {
      paddingHorizontal: space(3),
      paddingVertical: space(2),
      borderRadius: radius.sm,
      backgroundColor: p.accentSoft,
      borderWidth: 1,
      borderColor: p.border,
      maxWidth: 220,
    },
    suggestionText: { fontSize: 14, color: p.accent, fontWeight: '600' },

    toolbar: {
      maxHeight: 52,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      backgroundColor: p.surface,
    },
    toolbarInner: { alignItems: 'center', paddingHorizontal: space(2), gap: space(1) },
    tool: { padding: space(3), borderRadius: radius.sm },
  });
}
