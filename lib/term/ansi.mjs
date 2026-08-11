/**
 * Terminal primitives: colours, screen control, and the width maths the
 * flicker-free repaint depends on.
 */

// --- Screen control --------------------------------------------------------

/** Alternate screen buffer — the shell's scrollback is restored on exit. */
export const ALT_SCREEN_ON = "\x1b[?1049h";
export const ALT_SCREEN_OFF = "\x1b[?1049l";
export const CURSOR_HIDE = "\x1b[?25l";
export const CURSOR_SHOW = "\x1b[?25h";
/** Autowrap off: a line that overflows would otherwise push the whole layout
 * down a row, and every subsequent line would repaint at the wrong position. */
export const WRAP_OFF = "\x1b[?7l";
export const WRAP_ON = "\x1b[?7h";
export const CLEAR_SCREEN = "\x1b[2J";
export const CLEAR_LINE = "\x1b[2K";
export const RESET = "\x1b[0m";

/** 1-based cursor placement. */
export const moveTo = (row, col = 1) => `\x1b[${row};${col}H`;

// --- Colour ----------------------------------------------------------------

let colorEnabled = false;
export function setColorEnabled(on) {
  colorEnabled = Boolean(on);
}

const paint = (code) => (s) =>
  colorEnabled ? `\x1b[${code}m${s}\x1b[0m` : String(s);

export const dim = paint("2");
export const bold = paint("1");
export const red = paint("31");
export const yellow = paint("33");
export const green = paint("32");
export const cyan = paint("36");
export const inverse = paint("7");

// --- Width -----------------------------------------------------------------

// Matches a CSI escape sequence (what our colour codes are); these occupy no
// screen columns and must not be counted or cut through.
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/;
const ANSI_RE_G = new RegExp(ANSI_RE.source, "g");

export function stripAnsi(str) {
  return String(str).replace(ANSI_RE_G, "");
}

/** Codepoints that occupy two terminal columns. `Emoji_Presentation` covers the
 * emoji that default to wide (🧜 🪙 ✨) while leaving text-presentation symbols
 * such as ✓ and ⚠ narrow — a blanket "dingbats are wide" rule gets those wrong. */
const WIDE_EMOJI = /\p{Emoji_Presentation}/u;
const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0xa4cf], // CJK radicals … Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
];

function isWideChar(ch) {
  const cp = ch.codePointAt(0);
  if (WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  return WIDE_EMOJI.test(ch);
}

/**
 * Printable width of a string in terminal columns: escape sequences are free,
 * emoji are two columns wide, and a variation selector (U+FE0F) promotes the
 * character before it to emoji presentation — so `🍽️` is 2, not 1.
 */
export function displayWidth(str) {
  const chars = [...stripAnsi(str)];
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (cp === 0xfe0f || cp === 0xfe0e) continue; // variation selector
    if (cp === 0x200d) {
      i++; // ZWJ: the joined pair renders as one glyph
      continue;
    }
    const vs16 = chars[i + 1]?.codePointAt(0) === 0xfe0f;
    width += vs16 || isWideChar(chars[i]) ? 2 : 1;
  }
  return width;
}

/**
 * Cut a string to at most `max` columns, keeping escape sequences intact (they
 * are copied through at zero width) and re-appending a reset if any colour was
 * still open at the cut. Returns the string untouched when it already fits.
 */
export function truncateToWidth(str, max) {
  if (max <= 0) return "";
  const s = String(str);
  if (displayWidth(s) <= max) return s;

  let out = "";
  let width = 0;
  let sawAnsi = false;
  for (let i = 0; i < s.length;) {
    if (s[i] === "\x1b") {
      const m = ANSI_RE.exec(s.slice(i));
      if (m && m.index === 0) {
        out += m[0];
        i += m[0].length;
        sawAnsi = true;
        continue;
      }
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const w = displayWidth(ch);
    if (width + w > max) break;
    out += ch;
    width += w;
    i += ch.length;
  }
  return sawAnsi ? out + RESET : out;
}
