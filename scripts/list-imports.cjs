#!/usr/bin/env node
// Lists how the client's files reach each other, so the folder boundaries can be checked.
//   node scripts/list-imports.cjs [--root <client dir>]            prints the sorted JSON below (same result every run)
//   node scripts/list-imports.cjs --check <baseline.json>          exit 1 if anything crosses folders that the baseline does not allow
// Output: {"client": {"crossFolderImports": [[from, to], ...], "globals": [...], "classicScripts": [...], "problems": [...]}}
//   - paths are relative to client/, sorted; "folder" = the first sub-folder under desktop/ shared/ ui/ assets/; files directly in
//     one of those four are in the folder named after it (ui/app.js -> "ui").
//   - recognised: import ... from '...', import '...', export ... from '...', require('...'). import() and require(<not a string>)
//     are reported in "problems" ("problems" is left out when empty). Packages (electron, node:fs ...) are ignored.
//   - classicScripts: <script src> without type="module" in the .html files under ui/.
// Only Node's own modules are used.
'use strict';
const fs = require('fs');
const path = require('path');

const TOP = ['desktop', 'shared', 'ui', 'assets'];
const GLOBALS = ['window.edup', 'EdupHuman', 'ai-iframe-message', 'localStorage:edup-A-snapshot'];
const CODE = /\.(js|cjs|mjs)$/;
// Registered exception: desktop/bootstrap.cjs starts the selected (possibly patched) entry file by a name it reads at run time.
const ALLOWED_DYNAMIC = {'desktop/bootstrap.cjs': ['require() with a name that is not a plain string']};
const TRY = ['', '.js', '.cjs', '.mjs', '.json', '/index.js', '/index.cjs', '/index.mjs'];

function folderOf(rel) {
  const parts = rel.split('/');
  if (TOP.includes(parts[0])) return parts.length >= 3 ? parts[0] + '/' + parts[1] : parts[0];
  return parts.length > 1 ? parts[0] : '.';
}

// ---- tokenizer: strings, comments, templates and regex literals are understood so that text inside them is never mistaken for code
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevAllowsRegex = () => {
    const t = out[out.length - 1];
    if (!t) return true;
    if (t.k === 'str' || t.k === 'num') return false;
    if (t.k === 'id') return REGEX_AFTER.has(t.v);
    return !(t.v === ')' || t.v === ']');
  };
  const readTemplate = () => { // at the opening backtick; returns when the closing one is consumed
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth) {
          const c = src[i];
          if (c === '{') { depth++; i++; } else if (c === '}') { depth--; i++; } else if (c === '`') readTemplate();
          else if (c === '"' || c === "'") readString();
          else i++;
        }
        continue;
      }
      i++;
    }
    i++;
  };
  const readString = () => {
    const q = src[i++];
    let v = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { v += src[i + 1] || ''; i += 2; continue; }
      if (src[i] === '\n') break;
      v += src[i++];
    }
    i++;
    return v;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") { out.push({k: 'str', v: readString()}); continue; }
    if (c === '`') { readTemplate(); out.push({k: 'tpl', v: ''}); continue; }
    if (c === '/' && prevAllowsRegex()) {
      i++;
      let cls = false;
      while (i < n && (src[i] !== '/' || cls)) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '\n') break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(src[i] || '')) i++;
      out.push({k: 'num', v: 'regex'});
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; out.push({k: 'id', v: src.slice(i, j)}); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; out.push({k: 'num', v: src.slice(i, j)}); i = j; continue; }
    out.push({k: 'p', v: c});
    i++;
  }
  return out;
}

// returns {specs: [string], problems: [string]} for one source text
function scan(src) {
  const t = tokenize(src);
  const specs = [];
  const problems = [];
  const isP = (x, v) => x && x.k === 'p' && x.v === v;
  const isId = (x, v) => x && x.k === 'id' && x.v === v;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    const before = t[i - 1];
    if (isP(before, '.')) continue;
    if (isId(x, 'import')) {
      const nx = t[i + 1];
      if (isP(nx, '(')) { problems.push('dynamic import()'); continue; }
      if (isP(nx, '.')) continue; // import.meta
      if (nx && nx.k === 'str') { specs.push(nx.v); continue; }
      for (let j = i + 1; j < t.length && j < i + 400; j++) { // import a, {b as c} from '...'
        if (isP(t[j], ';')) break;
        if (isId(t[j], 'from') && t[j + 1] && t[j + 1].k === 'str') { specs.push(t[j + 1].v); break; }
      }
    } else if (isId(x, 'export') && (isP(t[i + 1], '{') || isP(t[i + 1], '*'))) {
      for (let j = i + 1; j < t.length && j < i + 400; j++) {
        if (isP(t[j], ';')) break;
        if (isId(t[j], 'from') && t[j + 1] && t[j + 1].k === 'str') { specs.push(t[j + 1].v); break; }
        if (isP(t[j], '}') && !isId(t[j + 1], 'from')) break;
      }
    } else if (isId(x, 'require') && isP(t[i + 1], '(')) {
      if (t[i + 2] && t[i + 2].k === 'str' && isP(t[i + 3], ')')) specs.push(t[i + 2].v);
      else problems.push('require() with a name that is not a plain string');
    }
  }
  return {specs, problems};
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files); else files.push(full);
  }
  return files;
}

function list(root) {
  const rel = f => path.relative(root, f).split(path.sep).join('/');
  const pairs = new Set();
  const problems = new Set();
  const classic = new Set();
  const files = TOP.flatMap(d => walk(path.join(root, d)));
  for (const file of files) {
    const from = rel(file);
    if (CODE.test(file)) {
      const {specs, problems: found} = scan(fs.readFileSync(file, 'utf8'));
      for (const p of found) if (!(ALLOWED_DYNAMIC[from] || []).includes(p)) problems.add(from + ': ' + p);
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue; // packages and node: modules
        const base = path.resolve(path.dirname(file), spec);
        const hit = TRY.map(s => base + s).find(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (!hit) { problems.add(from + ": can't find " + spec); continue; }
        const to = rel(hit);
        if (folderOf(from) !== folderOf(to)) pairs.add(JSON.stringify([from, to]));
      }
    } else if (/\.html?$/.test(file) && from.startsWith('ui/')) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>/gi)) {
        const attrs = m[1];
        const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (!src || /\btype\s*=\s*["']?module/i.test(attrs)) continue;
        classic.add(rel(path.resolve(path.dirname(file), src[1].split('?')[0])));
      }
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const client = {
    crossFolderImports: [...pairs].map(s => JSON.parse(s)).sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1])),
    globals: [...GLOBALS].sort(),
    classicScripts: [...classic].sort(cmp)
  };
  if (problems.size) client.problems = [...problems].sort(cmp);
  return {client};
}

function check(current, baseline) {
  const cur = current.client;
  const base = baseline.client || {};
  const bad = [];
  const allowed = new Set((base.crossFolderImports || []).map(p => JSON.stringify(p)));
  for (const p of cur.crossFolderImports) {
    if (p[0].startsWith('desktop/') && p[1].startsWith('ui/')) bad.push('desktop/ must not use ui/: ' + p[0] + ' -> ' + p[1]);
    else if (!allowed.has(JSON.stringify(p))) bad.push('new cross-folder import: ' + p[0] + ' -> ' + p[1]);
  }
  for (const g of cur.globals) if (!(base.globals || []).includes(g)) bad.push('new global name: ' + g);
  for (const s of cur.classicScripts) if (!(base.classicScripts || []).includes(s)) bad.push('new classic <script>: ' + s);
  for (const p of cur.problems || []) if (p.includes('dynamic import()')) bad.push(p);
  return bad;
}

function main(argv) {
  let root = path.resolve(__dirname, '..');
  let baselinePath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--check') baselinePath = argv[++i];
    else { console.error('usage: list-imports.cjs [--root <client dir>] [--check <baseline.json>]'); return 2; }
  }
  const current = list(root);
  if (!baselinePath) { process.stdout.write(JSON.stringify(current, null, 2) + '\n'); return 0; }
  let baseline;
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); } catch (error) { console.error('cannot read the baseline: ' + error.message); return 2; }
  const bad = check(current, baseline);
  if (bad.length) { for (const line of bad) console.error(line); return 1; }
  console.log('client import boundaries ok');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = {list, check, scan, folderOf};
