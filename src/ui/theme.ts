// Visual language.
//
// The reference point is paper, not chrome. A note app is a place people put
// unfinished thinking, so the surface should be quiet: warm neutrals, one accent
// colour used sparingly, and type large enough to write in comfortably for an
// hour. Nothing here animates for its own sake.

export interface Palette {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  highlight: string;
  danger: string;
  success: string;
  /** Background behind a search match. */
  mark: string;
  shadow: string;
}

const LIGHT: Palette = {
  dark: false,
  bg: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F1EC',
  border: '#E7E3DA',
  borderStrong: '#D6D0C4',
  text: '#1E1C18',
  textDim: '#6B6558',
  textFaint: '#9A9284',
  accent: '#C7791A',
  accentSoft: '#FBEEDC',
  accentText: '#FFFFFF',
  highlight: '#FDF2C9',
  danger: '#C0392B',
  success: '#3E7C4A',
  mark: '#FBE3A8',
  shadow: '#00000018',
};

const DARK: Palette = {
  dark: true,
  bg: '#141311',
  surface: '#1C1A17',
  surfaceAlt: '#24211D',
  border: '#2E2A25',
  borderStrong: '#3D3830',
  text: '#F2EFE8',
  textDim: '#A69E90',
  textFaint: '#736C60',
  accent: '#E8A33D',
  accentSoft: '#2E2517',
  accentText: '#181510',
  highlight: '#3A3016',
  danger: '#E0645A',
  success: '#6FBF7F',
  mark: '#5A4718',
  shadow: '#00000060',
};

export function palette(scheme: 'light' | 'dark'): Palette {
  return scheme === 'dark' ? DARK : LIGHT;
}

/** Accent choices offered in settings. */
export const ACCENTS: { name: string; light: string; dark: string }[] = [
  { name: 'Amber', light: '#C7791A', dark: '#E8A33D' },
  { name: 'Ink', light: '#2F4858', dark: '#7FA8C4' },
  { name: 'Moss', light: '#4A6B3A', dark: '#8FBF75' },
  { name: 'Clay', light: '#A8543F', dark: '#DE8E75' },
  { name: 'Plum', light: '#6B3F6E', dark: '#C08CC4' },
  { name: 'Slate', light: '#4A4E55', dark: '#A8AEB8' },
];

export const space = (n: number) => n * 4;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const type = {
  display: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' as const },
  small: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.2 },
};

/** Editor font stacks, chosen per platform in the component. */
export const FONTS = {
  sans: undefined as string | undefined,
  serif: 'Georgia',
  mono: 'Menlo',
};

/** A short, human relative time: "now", "12m", "3h", "Tue", "12 Mar". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const min = diff / 60000;
  if (min < 1) return 'now';
  if (min < 60) return `${Math.floor(min)}m`;
  const hours = min / 60;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = hours / 24;
  if (days < 7) {
    return new Date(at).toLocaleDateString(undefined, { weekday: 'short' });
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString(
    undefined,
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

/** A full timestamp for history entries. */
export function fullTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
