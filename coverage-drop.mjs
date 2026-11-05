#!/usr/bin/env node
// coverage-drop: did this change lower the test coverage of the code it touched?
// Compares two LCOV reports (base and head) and, given the change's diff, lists the
// added lines that no test executes. Plain Node, built-in modules only.

import { readFileSync } from 'node:fs';

const TOOL = 'coverage-drop';
const VERSION = '0.1.0';

const USAGE =
  'usage: coverage-drop <base.info> <head.info> [--diff <file>] [--root <prefix>]... [--json | --markdown] ' +
  '[--fail-on-drop <points>] [--fail-on-untested]';

class UsageError extends Error {}
class ReadError extends Error {}

// ---------------------------------------------------------------- paths

// Steps 1 and 2 of the path rules: backslashes to slashes, "." segments removed.
function normalizePath(path) {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '.')
    .join('/');
}

function normalizeRoot(root) {
  return normalizePath(root).replace(/\/+$/, '');
}

function stripRoot(path, roots) {
  let best = null;
  for (const root of roots) {
    if (path.startsWith(root + '/') && (best === null || root.length > best.length)) best = root;
  }
  return best === null ? path : path.slice(best.length + 1);
}

// ---------------------------------------------------------------- numbers

// Integer hundredths of H * 100 / F, rounded half up; null when F is 0.
function hundredths(hit, found) {
  if (found === 0) return null;
  const numerator = hit * 20000 + found;
  const denominator = 2 * found;
  return (numerator - (numerator % denominator)) / denominator;
}

function coverage(found, hit) {
  const h = hundredths(hit, found);
  return { found, hit, percent: h === null ? null : h / 100 };
}

function hundredthsOf(cov) {
  return cov === null || cov.percent === null ? null : Math.round(cov.percent * 100);
}

// Change in points as a number (difference of the rounded percentages), or null.
function changeOf(before, after) {
  const b = hundredthsOf(before);
  const a = hundredthsOf(after);
  if (b === null || a === null) return null;
  return (a - b) / 100;
}

function pair(before, after) {
  return { before, after, change: changeOf(before, after) };
}

// ---------------------------------------------------------------- LCOV

const DIGITS = /^[0-9]+$/;
const NONZERO = /[1-9]/;

function parseLcov(text, roots) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const files = new Map();
  let current = null;
  const lines = text.split('\n');
  for (let raw of lines) {
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw.startsWith('SF:')) {
      const path = stripRoot(normalizePath(raw.slice(3)), roots);
      if (path === '') {
        current = null;
        continue;
      }
      current = files.get(path);
      if (!current) {
        current = { lines: new Map(), branches: new Map() };
        files.set(path, current);
      }
    } else if (raw === 'end_of_record') {
      current = null;
    } else if (current !== null && raw.startsWith('DA:')) {
      const fields = raw.slice(3).split(',');
      if (fields.length !== 2 && fields.length !== 3) continue;
      const [line, hits] = fields;
      if (!DIGITS.test(line) || !DIGITS.test(hits) || !NONZERO.test(line)) continue;
      const number = Number(line);
      const executed = NONZERO.test(hits);
      current.lines.set(number, current.lines.get(number) === true || executed);
    } else if (current !== null && raw.startsWith('BRDA:')) {
      const fields = raw.slice(5).split(',');
      if (fields.length !== 4) continue;
      const [line, block, branch, taken] = fields;
      if (!DIGITS.test(line) || !NONZERO.test(line) || block === '' || branch === '') continue;
      if (taken !== '-' && !DIGITS.test(taken)) continue;
      const id = `${line},${block},${branch}`;
      const isTaken = taken !== '-' && NONZERO.test(taken);
      current.branches.set(id, current.branches.get(id) === true || isTaken);
    }
  }
  const result = new Map();
  for (const [path, file] of files) {
    let lineHit = 0;
    for (const executed of file.lines.values()) if (executed) lineHit++;
    let branchHit = 0;
    for (const taken of file.branches.values()) if (taken) branchHit++;
    result.set(path, {
      lines: coverage(file.lines.size, lineHit),
      branches: coverage(file.branches.size, branchHit),
      executed: file.lines,
    });
  }
  return result;
}

// ---------------------------------------------------------------- diff

const HUNK = /^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@/;

function pathOfPlusLine(text) {
  const tab = text.indexOf('\t');
  if (tab !== -1) text = text.slice(0, tab);
  if (text === '/dev/null') return null;
  if (text.startsWith('b/')) text = text.slice(2);
  const path = normalizePath(text);
  return path === '' ? null : path;
}

// Map of path -> Set of changed (added) new-file line numbers.
function parseDiff(text) {
  const changed = new Map();
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (let i = 0; i < lines.length; i++) if (lines[i].endsWith('\r')) lines[i] = lines[i].slice(0, -1);

  let file = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const header = HUNK.exec(line);
    if (header) {
      i++;
      let oldLeft = header[2] === undefined ? 1 : Number(header[2]);
      let newLeft = header[4] === undefined ? 1 : Number(header[4]);
      let newNo = Number(header[3]);
      while ((oldLeft > 0 || newLeft > 0) && i < lines.length) {
        const body = lines[i];
        if (body.startsWith('\\')) {
          i++;
        } else if (body === '' || body.startsWith(' ')) {
          if (oldLeft === 0 || newLeft === 0) break;
          oldLeft--;
          newLeft--;
          newNo++;
          i++;
        } else if (body.startsWith('-')) {
          if (oldLeft === 0) break;
          oldLeft--;
          i++;
        } else if (body.startsWith('+')) {
          if (newLeft === 0) break;
          if (file !== null) {
            let set = changed.get(file);
            if (!set) changed.set(file, (set = new Set()));
            set.add(newNo);
          }
          newLeft--;
          newNo++;
          i++;
        } else {
          break;
        }
      }
    } else {
      if (line.startsWith('diff --git ')) file = null;
      else if (line.startsWith('+++ ')) file = pathOfPlusLine(line.slice(4));
      i++;
    }
  }
  return changed;
}

function toRanges(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges;
}

function rangeText(ranges) {
  return ranges.map((r) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`)).join(', ');
}

// ---------------------------------------------------------------- report

function buildReport(base, head, changed) {
  const paths = [...new Set([...base.keys(), ...head.keys()])].sort();
  const files = [];
  const newFiles = [];
  const removedFiles = [];
  const sum = { baseL: [0, 0], headL: [0, 0], baseB: [0, 0], headB: [0, 0] };
  for (const f of base.values()) {
    sum.baseL[0] += f.lines.found;
    sum.baseL[1] += f.lines.hit;
    sum.baseB[0] += f.branches.found;
    sum.baseB[1] += f.branches.hit;
  }
  for (const f of head.values()) {
    sum.headL[0] += f.lines.found;
    sum.headL[1] += f.lines.hit;
    sum.headB[0] += f.branches.found;
    sum.headB[1] += f.branches.hit;
  }
  for (const path of paths) {
    const b = base.get(path) ?? null;
    const h = head.get(path) ?? null;
    let status;
    if (b === null) status = 'added';
    else if (h === null) status = 'removed';
    else status = b.lines.found === h.lines.found && b.lines.hit === h.lines.hit ? 'unchanged' : 'changed';
    if (status === 'added') newFiles.push(path);
    if (status === 'removed') removedFiles.push(path);
    files.push({
      file: path,
      status,
      lines: pair(b && b.lines, h && h.lines),
      branches: pair(b && b.branches, h && h.branches),
    });
  }

  let untested = null;
  if (changed !== null) {
    untested = { count: 0, files: [] };
    for (const path of [...changed.keys()].sort()) {
      const headFile = head.get(path);
      if (!headFile) continue;
      const lines = [...changed.get(path)].filter((n) => headFile.executed.get(n) === false);
      if (lines.length === 0) continue;
      untested.count += lines.length;
      untested.files.push({ file: path, count: lines.length, ranges: toRanges(lines) });
    }
  }

  return {
    tool: TOOL,
    version: VERSION,
    total: {
      lines: pair(coverage(...sum.baseL), coverage(...sum.headL)),
      branches: pair(coverage(...sum.baseB), coverage(...sum.headB)),
    },
    files,
    new_files: newFiles,
    removed_files: removedFiles,
    untested,
    failures: [],
  };
}

// ---------------------------------------------------------------- output

function twoDecimals(h) {
  return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
}

function cell(cov) {
  if (cov === null) return '-';
  if (cov.percent === null) return 'n/a';
  return `${twoDecimals(hundredthsOf(cov))}%`;
}

function points(change) {
  if (change === null) return 'n/a';
  const h = Math.round(change * 100);
  if (h === 0) return '0.00 points';
  return `${h < 0 ? '-' : '+'}${twoDecimals(Math.abs(h))} points`;
}

function fileChange(file) {
  if (file.status === 'added') return 'new file';
  if (file.status === 'removed') return 'removed file';
  return points(file.lines.change);
}

function totalLine(report) {
  const t = report.total.lines;
  return `total ${cell(t.before)} -> ${cell(t.after)} (${points(t.change)})`;
}

function plainReport(report) {
  const out = [`${TOOL}: ${totalLine(report)}`];
  const shown = report.files.filter((f) => f.status !== 'unchanged');
  if (shown.length > 0) {
    out.push('', 'Files:');
    for (const f of shown) {
      out.push(`  ${f.file}: ${cell(f.lines.before)} -> ${cell(f.lines.after)} (${fileChange(f)})`);
    }
  }
  if (report.untested !== null) {
    out.push('', `Untested changed lines: ${report.untested.count}`);
    for (const f of report.untested.files) out.push(`  ${f.file}: ${rangeText(f.ranges)}`);
  }
  return out.join('\n') + '\n';
}

function markdownReport(report) {
  const out = [`## ${TOOL}: ${totalLine(report)}`];
  const shown = report.files.filter((f) => f.status !== 'unchanged');
  if (shown.length > 0) {
    out.push('', '| File | Before | After | Change |', '|---|---|---|---|');
    for (const f of shown) {
      const name = f.file.replaceAll('|', '\\|');
      out.push(`| \`${name}\` | ${cell(f.lines.before)} | ${cell(f.lines.after)} | ${fileChange(f)} |`);
    }
  }
  if (report.untested !== null) {
    out.push('', `### Untested changed lines (${report.untested.count})`);
    if (report.untested.count > 0) {
      out.push('');
      for (const f of report.untested.files) out.push(`- \`${f.file}\`: ${rangeText(f.ranges)}`);
    }
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- arguments

const VALUE_OPTIONS = new Set(['--diff', '--root', '--fail-on-drop']);
const FLAG_OPTIONS = new Set(['--json', '--markdown', '--fail-on-untested']);

function parseArgs(args) {
  // --help wins over everything, unless it is the value of an option.
  for (let i = 0; i < args.length; i++) {
    if (VALUE_OPTIONS.has(args[i])) i++;
    else if (args[i] === '--help') return { help: true };
  }

  const opts = {
    files: [],
    diff: null,
    roots: [],
    json: false,
    markdown: false,
    failOnDrop: null,
    failOnUntested: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_OPTIONS.has(arg)) {
      if (i + 1 >= args.length) throw new UsageError(`option ${arg} needs a value`);
      const value = args[++i];
      if (arg === '--diff') {
        if (value === '') throw new UsageError('--diff needs a file name, got an empty value');
        opts.diff = value;
      } else if (arg === '--root') {
        const root = normalizeRoot(value);
        if (root === '') throw new UsageError(`--root needs a prefix that is not empty, got "${value}"`);
        opts.roots.push(root);
      } else {
        if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
          throw new UsageError(`--fail-on-drop needs a number such as 5 or 0.5, got "${value}"`);
        }
        opts.failOnDrop = value;
      }
    } else if (arg === '--json') opts.json = true;
    else if (arg === '--markdown') opts.markdown = true;
    else if (arg === '--fail-on-untested') opts.failOnUntested = true;
    else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
    else opts.files.push(arg);
  }
  if (opts.json && opts.markdown) throw new UsageError('--json and --markdown cannot be used together');
  if (opts.files.length !== 2) {
    throw new UsageError(`two coverage files are needed (base and head), got ${opts.files.length}`);
  }
  if (opts.failOnUntested && opts.diff === null) throw new UsageError('--fail-on-untested needs --diff');
  return opts;
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new ReadError(`cannot read ${path}: ${error.code ?? error.message}`);
  }
}

// True when the drop (a negative change in points) is larger than the decimal string `limit`.
function dropExceeds(change, limit) {
  if (change === null || change >= 0) return false;
  const drop = BigInt(Math.round(-change * 100)); // hundredths of a point
  const [whole, fraction = ''] = limit.split('.');
  const scaled = BigInt(whole + fraction); // limit * 10^fraction.length
  return drop * 10n ** BigInt(fraction.length) > scaled * 100n;
}

function main(args) {
  const opts = parseArgs(args);
  if (opts.help) {
    return { stdout: USAGE + '\n', code: 0 };
  }
  const baseText = readText(opts.files[0]);
  const headText = readText(opts.files[1]);
  const diffText = opts.diff === null ? null : readText(opts.diff);

  const base = parseLcov(baseText, opts.roots);
  const head = parseLcov(headText, opts.roots);
  const report = buildReport(base, head, diffText === null ? null : parseDiff(diffText));

  if (opts.failOnDrop !== null && dropExceeds(report.total.lines.change, opts.failOnDrop)) {
    report.failures.push('drop');
  }
  if (opts.failOnUntested && report.untested !== null && report.untested.count > 0) {
    report.failures.push('untested');
  }

  let stdout;
  if (opts.json) stdout = JSON.stringify(report, null, 2) + '\n';
  else if (opts.markdown) stdout = markdownReport(report);
  else stdout = plainReport(report);
  return { stdout, code: report.failures.length > 0 ? 1 : 0 };
}

try {
  const { stdout, code } = main(process.argv.slice(2));
  process.stdout.write(stdout);
  process.exitCode = code;
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${TOOL}: ${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else if (error instanceof ReadError) {
    process.stderr.write(`${TOOL}: ${error.message}\n`);
    process.exitCode = 3;
  } else {
    throw error;
  }
}
