// The connections view.
//
// Apple Notes has no idea that one note relates to another. This screen is the
// payoff for [[wikilinks]]: the shape of what you have been thinking about,
// where hubs sit in the middle and orphans sit at the edge.

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { layoutGraph } from '../core/layout.ts';
import { extractLinks, type LinkGraph } from '../core/links.ts';
import type { Note } from '../core/types.ts';
import { Icon } from './Icon.tsx';
import { radius, space, type Palette } from './theme.ts';

/** Nodes drawn at once. Beyond this the picture stops being readable. */
const MAX_NODES = 90;

export function Graph({
  palette: p,
  notes,
  graph,
  width,
  height,
  onOpen,
  onBack,
  onCreate,
}: {
  palette: Palette;
  notes: Map<string, Note>;
  graph: LinkGraph;
  width: number;
  height: number;
  onOpen: (id: string) => void;
  onBack: () => void;
  onCreate: (title: string) => void;
}) {
  const s = React.useMemo(() => sheet(p), [p]);

  const { nodes, edges, hidden } = React.useMemo(() => {
    const live = [...notes.values()].filter((n) => n.trashedAt === null && !n.archived);
    const degree = new Map<string, number>();
    for (const n of live) {
      const out = graph.outgoing.get(n.id)?.length ?? 0;
      const inc = graph.incoming.get(n.id)?.length ?? 0;
      degree.set(n.id, out + inc);
    }
    // Prefer connected notes when there are more than fit; an unconnected note
    // contributes nothing to a picture of connections.
    const ranked = [...live].sort(
      (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || b.updatedAt - a.updatedAt,
    );
    const chosen = ranked.slice(0, MAX_NODES);
    const keep = new Set(chosen.map((n) => n.id));
    const es = graph.edges().filter((e) => keep.has(e.from) && keep.has(e.to));
    return { nodes: chosen, edges: es, hidden: live.length - chosen.length };
  }, [notes, graph]);

  const canvasH = Math.max(260, height - 190);
  const positions = React.useMemo(
    () => layoutGraph(nodes.map((n) => n.id), edges, { width, height: canvasH }),
    [nodes, edges, width, canvasH],
  );
  const posById = React.useMemo(() => new Map(positions.map((pn) => [pn.id, pn])), [positions]);

  // Unresolved entries are keyed by the normalised link key, which is
  // lowercased. Recover how the link was actually written by looking at one
  // note that references it, so the invitation reads "Piranesi notes" rather
  // than "piranesi notes". Only the handful shown are scanned.
  const unresolved = React.useMemo(() => {
    return [...graph.unresolved.values()].slice(0, 24).map((u) => {
      for (const from of u.from) {
        const source = notes.get(from);
        if (!source) continue;
        const match = extractLinks(source.body).find((l) => l.key === u.target);
        if (match) return { key: u.target, label: match.target };
      }
      return { key: u.target, label: u.target };
    });
  }, [graph, notes]);
  const connected = positions.filter((n) => n.weight > 0).length;

  return (
    <View style={s.screen}>
      <View style={s.bar}>
        <Pressable onPress={onBack} hitSlop={12} style={s.barBtn} accessibilityLabel="Back to notes">
          <Icon name="back" size={22} color={p.text} />
        </Pressable>
        <Text style={s.barTitle}>Connections</Text>
        <View style={s.barBtn} />
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {nodes.length === 0 ? (
          <View style={s.empty}>
            <Icon name="graph" size={30} color={p.textFaint} />
            <Text style={s.emptyTitle}>Nothing to connect yet</Text>
            <Text style={s.emptyBody}>
              Type [[ inside a note to link it to another. Links work both ways, so the note you point at
              knows about it too.
            </Text>
          </View>
        ) : (
          <>
            <Text style={s.stat}>
              {connected} of {positions.length} notes linked · {edges.length}{' '}
              {edges.length === 1 ? 'connection' : 'connections'}
              {hidden > 0 ? ` · ${hidden} not shown` : ''}
            </Text>

            <Svg width={width} height={canvasH}>
              {edges.map((e, i) => {
                const a = posById.get(e.from);
                const b = posById.get(e.to);
                if (!a || !b) return null;
                return (
                  <SvgLine
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={p.borderStrong}
                    strokeWidth={1.1}
                  />
                );
              })}
              {positions.map((pn) => {
                const note = notes.get(pn.id);
                if (!note) return null;
                const r = 5 + Math.min(11, pn.weight * 2.1);
                const full = note.title.trim() || 'Untitled';
                // Truncate on a word boundary so labels do not end mid-word.
                const label = full.length <= 20 ? full : full.slice(0, 19).replace(/\s+\S*$/, '') + '…';
                return (
                  <React.Fragment key={pn.id}>
                    <Circle
                      cx={pn.x}
                      cy={pn.y}
                      r={r}
                      fill={pn.weight > 0 ? p.accent : p.surfaceAlt}
                      stroke={pn.weight > 0 ? p.accent : p.borderStrong}
                      strokeWidth={1.4}
                      onPress={() => onOpen(pn.id)}
                    />
                    {pn.weight > 0 || positions.length < 26 ? (
                      <SvgText
                        x={pn.x}
                        y={pn.y + r + 12}
                        fontSize={10.5}
                        fill={p.textDim}
                        textAnchor="middle"
                        onPress={() => onOpen(pn.id)}
                      >
                        {label}
                      </SvgText>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </Svg>
          </>
        )}

        {unresolved.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Mentioned but not written yet</Text>
            <Text style={s.sectionBody}>
              These notes are linked from somewhere but do not exist. Tap to write one.
            </Text>
            <View style={s.pills}>
              {unresolved.map((u) => (
                <Pressable key={u.key} onPress={() => onCreate(u.label)} style={s.pill}>
                  <Icon name="plus" size={13} color={p.accent} />
                  <Text style={s.pillText}>{u.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function sheet(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space(2),
      height: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    barBtn: { padding: space(2.5), minWidth: 44 },
    barTitle: { fontSize: 16, fontWeight: '700', color: p.text },
    body: { paddingBottom: space(10) },
    stat: {
      fontSize: 12.5,
      color: p.textFaint,
      textAlign: 'center',
      paddingVertical: space(3),
    },
    empty: { alignItems: 'center', justifyContent: 'center', padding: space(8), gap: space(2), minHeight: 320 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: p.text, marginTop: space(2) },
    emptyBody: { fontSize: 14.5, color: p.textDim, textAlign: 'center', lineHeight: 21, maxWidth: 320 },
    section: {
      margin: space(4),
      padding: space(4),
      borderRadius: radius.md,
      backgroundColor: p.surfaceAlt,
      borderWidth: 1,
      borderColor: p.border,
    },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: p.text },
    sectionBody: { fontSize: 13, color: p.textDim, marginTop: space(1), lineHeight: 18 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(3) },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space(1),
      paddingHorizontal: space(3),
      paddingVertical: space(2),
      borderRadius: radius.pill,
      backgroundColor: p.surface,
      borderWidth: 1,
      borderColor: p.border,
    },
    pillText: { fontSize: 13, color: p.accent, fontWeight: '600' },
  });
}
