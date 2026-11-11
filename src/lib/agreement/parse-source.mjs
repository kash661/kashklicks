// Compiles the tagged agreement markdown (Part A of the vault note) into plain data.
// Rules mirror the mockup renderer render_agreement.py. Nothing is dropped silently:
// any line the parser does not understand throws with its line number.

const FLAG = /\s*⚑[A-Z]\d+/g;
const CLAUSE = /^\*\*(\d+)\.(\d+)\*\*\s+`\[([^\]]*)\]`\s+(.*)$/;
const SECTION = /^##\s+(\d+)\.\s+(.+?)\s*$/;
const BLOCK = /^\{\{(TABLE:BOOKING|LIST:DELIVERABLES|TABLE:ADDONS)\}\}$/;
const START = '<!-- AGREEMENT:START -->';
const END = '<!-- AGREEMENT:END -->';

/** Text strictly between the START and END markers, trimmed, with one trailing newline. */
export function extractPartA(vaultNote) {
  const a = vaultNote.indexOf(START);
  const b = vaultNote.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('agreement markers not found');
  return vaultNote.slice(a + START.length, b).trim() + '\n';
}

function fail(lineNo, message, raw) {
  throw new Error(`agreement source line ${lineNo}: ${message}: ${raw}`);
}

function stripFlags(text, lineNo, raw) {
  const out = text.replace(FLAG, '').trim();
  if (out.includes('⚑') || out.includes('`')) fail(lineNo, 'flag or backtick left after stripping', raw);
  return out;
}

export function parseAgreementSource(markdown) {
  let title = null;
  const intro = [];
  const sections = [];
  let cur = null;
  let last = null;

  markdown.split('\n').forEach((raw, idx) => {
    const lineNo = idx + 1;
    const s = raw.trim();
    if (!s) {
      last = null;
      return;
    }
    if (s.startsWith('# ')) {
      title = s.slice(2).trim();
      return;
    }
    if (s === '## Who we are') {
      cur = { num: 0, title: 'Who we are', items: [] };
      sections.push(cur);
      last = null;
      return;
    }
    const ms = SECTION.exec(s);
    if (ms) {
      cur = { num: Number(ms[1]), title: ms[2], items: [] };
      sections.push(cur);
      last = null;
      return;
    }
    if (cur === null) {
      intro.push(s);
      return;
    }
    const mc = CLAUSE.exec(s);
    if (mc) {
      const sn = Number(mc[1]);
      if (sn !== cur.num) fail(lineNo, 'clause number does not match its section', raw);
      last = {
        type: 'clause',
        id: `${sn}.${Number(mc[2])}`,
        tags: mc[3].split(/\s+/).filter(Boolean).map((alt) => alt.split('+')),
        text: stripFlags(mc[4], lineNo, raw),
        bullets: [],
      };
      cur.items.push(last);
      return;
    }
    if (s.startsWith('- ') && last !== null) {
      last.bullets.push(stripFlags(s.slice(2), lineNo, raw));
      return;
    }
    const mb = BLOCK.exec(s);
    if (mb) {
      cur.items.push({ type: 'block', name: mb[1] });
      last = null;
      return;
    }
    fail(lineNo, 'unrecognised line', raw);
  });

  if (title !== 'Photography and Film Agreement') throw new Error(`unexpected title: ${title}`);
  if (intro.length !== 1) throw new Error(`expected one intro paragraph, found ${intro.length}`);
  return { title, intro: intro[0], sections };
}
