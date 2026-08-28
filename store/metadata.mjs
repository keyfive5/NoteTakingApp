// App Store listing copy. Pushed by scripts/asc-metadata.mjs.
//
// Apple's guideline 2.3.7 rejects price references outside the description, so
// the promotional text and subtitle say nothing about cost.

export const NAME = 'Sift — Notes You Can Find'; // 25 / 30
export const SUBTITLE = 'Markdown notes, found fast'; // 26 / 30

export const PROMOTIONAL_TEXT =
  'Search that survives typos, plurals and compound words. Wikilinks and backlinks. Every version of every note kept. Your notes stay on your device as plain Markdown files.'; // 168 / 170

export const KEYWORDS =
  'notes,notepad,markdown,search,offline,private,journal,writing,checklist,todo,backlink,memo,local'; // 96 / 100

export const DESCRIPTION = `Sift is a notes app built around one question: can you find what you wrote?

Most note apps can't. Their search matches text exactly, so it misses "lightbulb" when you typed "light bulb", misses "running" when you searched "run", and gives you nothing at all when your thumbs put an extra letter in a word. Sift is built the other way round.

FIND WHAT YOU HALF REMEMBER

• Typo tolerance — "meting notes" finds "Meeting notes"
• Word endings — "run" finds "running", "city" finds "Cities"
• Compound words, both directions — "light bulb" finds "lightbulb", and the other way round too
• Accents ignored — "resume" finds "résumé"
• Results as you type, with the matching words marked so you can see why something matched
• Filters when you want them: tag:work/clients, is:todo, "exact phrase", -exclude, updated:>2026-01-01

NOTHING IS EVER LOST

Every save is a revision. Open the history of any note, read any earlier version, and bring it back with one tap. Restoring is itself just another revision, so it can't destroy anything either.

Notes are written one file at a time, and the history is written before the file is replaced — so even an interrupted write leaves your words recoverable. Deleted notes wait 30 days in the trash.

NOTES THAT KNOW ABOUT EACH OTHER

Type [[ to link one note to another. The link works both ways: the note you point at shows everything that points back. A connections view draws the shape of what you've been thinking about, and notes you've mentioned but not written yet become an invitation to write them.

WRITING THAT FEELS RIGHT

• Live Markdown — headings, bold, highlight, quotes, code, checklists
• Lists continue themselves; Return on an empty item ends the list
• Tap any line to put the cursor exactly there
• Tick checkboxes without entering edit mode
• Nested tags like #work/clients/acme
• Pin, archive, and lock notes behind Face ID
• Light and dark, six accent colours, three writing fonts, four text sizes

YOUR NOTES ARE YOURS

Every note is a plain Markdown file stored on your device. No account. No server. No sync that can fail, because there is nothing to sync. Export any note, or all of them, whenever you like.

Sift is free. There is no subscription, no advertising, no note limit, and no paid tier holding features back.`;

export const SUPPORT_URL = 'https://github.com/keyfive5/NoteTakingApp';
export const MARKETING_URL = 'https://github.com/keyfive5/NoteTakingApp';
export const PRIVACY_URL = 'https://github.com/keyfive5/NoteTakingApp/blob/main/PRIVACY.md';
export const COPYRIGHT = '2026 Muhammad Hasan Zafar';

export const PRIMARY_CATEGORY = 'PRODUCTIVITY';
export const SECONDARY_CATEGORY = 'UTILITIES';

/** Caption shown under each screenshot in this project's own notes. */
export const SHOT_CAPTIONS = [
  'Find the note you only half remember',
  'Typos, plurals and compound words. Handled.',
  'Markdown that reads like a finished page',
  'Notes that know about each other',
  'Every version kept. Nothing ever lost.',
];
