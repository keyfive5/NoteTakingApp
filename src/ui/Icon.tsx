// Icons, drawn as SVG paths on a 24x24 grid.
//
// Hand-rolled rather than pulled from an icon package: the app needs about
// twenty glyphs, and a dependency for that would add megabytes to the bundle and
// a font-loading step to every cold start.

import React from 'react';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';

export type IconName =
  | 'search' | 'plus' | 'pin' | 'pinned' | 'tag' | 'archive' | 'trash' | 'back'
  | 'more' | 'check' | 'lock' | 'unlock' | 'link' | 'graph' | 'settings' | 'close'
  | 'bold' | 'italic' | 'bullet' | 'checklist' | 'heading' | 'code' | 'quote'
  | 'history' | 'share' | 'sort' | 'chevron' | 'note' | 'restore' | 'indent'
  | 'outdent' | 'highlight' | 'strike' | 'numbered' | 'keyboard' | 'info' | 'star';

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <Circle cx={11} cy={11} r={6.5} />
      <Line x1={16} y1={16} x2={20.5} y2={20.5} />
    </>
  ),
  plus: (
    <>
      <Line x1={12} y1={5} x2={12} y2={19} />
      <Line x1={5} y1={12} x2={19} y2={12} />
    </>
  ),
  pin: <Path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6Z M12 14v7" />,
  pinned: <Path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6Z M12 14v7" />,
  tag: (
    <>
      <Path d="M3 12.5V4a1 1 0 0 1 1-1h8.5L21 11.5 12.5 20 3 12.5Z" />
      <Circle cx={7.5} cy={7.5} r={1.4} />
    </>
  ),
  archive: (
    <>
      <Rect x={3} y={4} width={18} height={4} rx={1} />
      <Path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <Line x1={10} y1={13} x2={14} y2={13} />
    </>
  ),
  trash: (
    <>
      <Path d="M4 7h16" />
      <Path d="M9 7V4h6v3" />
      <Path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
      <Line x1={10} y1={11} x2={10} y2={17} />
      <Line x1={14} y1={11} x2={14} y2={17} />
    </>
  ),
  back: <Path d="M15 4 7 12l8 8" />,
  more: (
    <>
      <Circle cx={5} cy={12} r={1.6} />
      <Circle cx={12} cy={12} r={1.6} />
      <Circle cx={19} cy={12} r={1.6} />
    </>
  ),
  check: <Path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  lock: (
    <>
      <Rect x={4.5} y={10} width={15} height={10} rx={2} />
      <Path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <Rect x={4.5} y={10} width={15} height={10} rx={2} />
      <Path d="M8 10V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  link: (
    <>
      <Path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.4 6.4" />
      <Path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </>
  ),
  graph: (
    <>
      <Circle cx={6} cy={7} r={2.6} />
      <Circle cx={18} cy={9} r={2.6} />
      <Circle cx={11} cy={18} r={2.6} />
      <Line x1={8.3} y1={8} x2={15.5} y2={8.7} />
      <Line x1={7.3} y1={9.3} x2={10} y2={15.5} />
      <Line x1={16.6} y1={11.2} x2={12.4} y2={15.9} />
    </>
  ),
  settings: (
    <>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M12 2.8v2.6M12 18.6v2.6M4.5 7.5l2.2 1.3M17.3 15.2l2.2 1.3M4.5 16.5l2.2-1.3M17.3 8.8l2.2-1.3" />
    </>
  ),
  close: (
    <>
      <Line x1={6} y1={6} x2={18} y2={18} />
      <Line x1={18} y1={6} x2={6} y2={18} />
    </>
  ),
  bold: <Path d="M7 4h6a4 4 0 0 1 0 8H7V4Zm0 8h7a4 4 0 0 1 0 8H7v-8Z" />,
  italic: (
    <>
      <Line x1={10} y1={4} x2={18} y2={4} />
      <Line x1={6} y1={20} x2={14} y2={20} />
      <Line x1={14} y1={4} x2={10} y2={20} />
    </>
  ),
  bullet: (
    <>
      <Circle cx={5} cy={7} r={1.5} />
      <Circle cx={5} cy={12} r={1.5} />
      <Circle cx={5} cy={17} r={1.5} />
      <Line x1={9.5} y1={7} x2={20} y2={7} />
      <Line x1={9.5} y1={12} x2={20} y2={12} />
      <Line x1={9.5} y1={17} x2={20} y2={17} />
    </>
  ),
  numbered: (
    <>
      <Path d="M4 6h1.5v4M4 15.5h2.5L4 18.5h2.5" />
      <Line x1={10} y1={7} x2={20} y2={7} />
      <Line x1={10} y1={12} x2={20} y2={12} />
      <Line x1={10} y1={17} x2={20} y2={17} />
    </>
  ),
  checklist: (
    <>
      <Path d="M3.5 7 5 8.5 8 5.5" />
      <Path d="M3.5 16.5 5 18l3-3" />
      <Line x1={11} y1={7} x2={20} y2={7} />
      <Line x1={11} y1={17} x2={20} y2={17} />
    </>
  ),
  heading: (
    <>
      <Line x1={6} y1={4} x2={6} y2={20} />
      <Line x1={16} y1={4} x2={16} y2={20} />
      <Line x1={6} y1={12} x2={16} y2={12} />
    </>
  ),
  code: <Path d="M8.5 8 4 12l4.5 4M15.5 8 20 12l-4.5 4M13.5 5l-3 14" />,
  quote: <Path d="M5 5v14M10 8h9M10 12h9M10 16h6" />,
  history: (
    <>
      <Path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <Path d="M4 4v4h4" />
      <Path d="M12 8v4.5l3 1.8" />
    </>
  ),
  share: (
    <>
      <Path d="M12 15V4" />
      <Path d="M8 7.5 12 3.5l4 4" />
      <Path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </>
  ),
  sort: (
    <>
      <Path d="M6 5v14M3 16l3 3 3-3" />
      <Line x1={12} y1={7} x2={21} y2={7} />
      <Line x1={12} y1={12} x2={19} y2={12} />
      <Line x1={12} y1={17} x2={17} y2={17} />
    </>
  ),
  chevron: <Path d="M9 5l7 7-7 7" />,
  note: (
    <>
      <Path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <Path d="M14 3v5h5" />
    </>
  ),
  restore: (
    <>
      <Path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <Path d="M4 4v4h4" />
    </>
  ),
  indent: (
    <>
      <Path d="M4 8l3 2.5L4 13" />
      <Line x1={10} y1={6} x2={20} y2={6} />
      <Line x1={10} y1={11} x2={20} y2={11} />
      <Line x1={4} y1={16} x2={20} y2={16} />
    </>
  ),
  outdent: (
    <>
      <Path d="M7 8l-3 2.5L7 13" />
      <Line x1={10} y1={6} x2={20} y2={6} />
      <Line x1={10} y1={11} x2={20} y2={11} />
      <Line x1={4} y1={16} x2={20} y2={16} />
    </>
  ),
  highlight: (
    <>
      <Path d="M5 15l6-9 5 3-6 9H5v-3Z" />
      <Line x1={4} y1={21} x2={20} y2={21} />
    </>
  ),
  strike: (
    <>
      <Line x1={4} y1={12} x2={20} y2={12} />
      <Path d="M8 8.5A3.5 3.5 0 0 1 15.5 7M16 15.5A3.5 3.5 0 0 1 8.5 17" />
    </>
  ),
  keyboard: (
    <>
      <Rect x={2.5} y={6} width={19} height={12} rx={2} />
      <Line x1={7} y1={15} x2={17} y2={15} />
      <Line x1={6} y1={10} x2={6.01} y2={10} />
      <Line x1={10} y1={10} x2={10.01} y2={10} />
      <Line x1={14} y1={10} x2={14.01} y2={10} />
      <Line x1={18} y1={10} x2={18.01} y2={10} />
    </>
  ),
  info: (
    <>
      <Circle cx={12} cy={12} r={8.5} />
      <Line x1={12} y1={11} x2={12} y2={16.5} />
      <Line x1={12} y1={7.8} x2={12.01} y2={7.8} />
    </>
  ),
  star: <Path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8L12 3.5Z" />,
};

/** Icons that read better filled than stroked. */
const FILLED = new Set<IconName>(['pinned', 'bold', 'star']);

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 1.7,
  filled,
}: {
  name: IconName;
  size?: number;
  color: string;
  strokeWidth?: number;
  filled?: boolean;
}) {
  const solid = filled ?? FILLED.has(name);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? color : 'none'}
      stroke={color}
      strokeWidth={solid ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </Svg>
  );
}
