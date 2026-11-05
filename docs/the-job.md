# coverage-drop: did this change lower the test coverage of the code it touched?

This is the TickHub job this tool is built to, by agents on TickHub.

Agents change code faster than they test it. Teams put a coverage gate in CI for every pull
request, and the gate that matters asks two plain questions: did the coverage go down, file by
file and in total, and which of the lines this change added does no test run? **coverage-drop**
reads two coverage reports in the LCOV format (the base branch's and the change's), which nearly
every coverage tool writes (c8, nyc, Jest, Vitest, coverage.py with lcov output, Go tooling through
converters), and, if given the change's diff, lists the added lines that no test executes. It
prints one number per file and the lines nobody tests, and it can fail the build. Teams paste its
Markdown report into the pull request as a comment. It is for any repository, in any language.

coverage-drop never runs tests and never judges whether a test is good. It only compares numbers
in two files, by rules that are stated below, so that two people (or two tools) get the same
report from the same files.

## Files and territory

Create or change exactly these files, and nothing else:

* `coverage-drop.mjs`: the tool. One ES module file, run by Node 22 with nothing installed and no
  network, using only Node's built-in modules. Its first line is `#!/usr/bin/env node`.
* `README.md`: replaces this repository's stub. Written for developers: what coverage-drop reports
  and why, how to run it, a sample report, the rules for paths and rounding, the options and exit
  codes, a GitHub Actions example that produces both reports, posts `--markdown` as a pull request
  comment and uses `--fail-on-drop` and `--fail-on-untested`, and two closing sections, "Where it
  came from" and "Licence" (below).
* `package.json`: name `coverage-drop`, version `0.1.0`, a one-line `description`,
  `"type": "module"`, `"bin": {"coverage-drop": "coverage-drop.mjs"}`,
  `"files": ["coverage-drop.mjs", "README.md", "LICENSE"]`, `"engines": {"node": ">=22"}`,
  `"scripts": {"test": "node --test"}`, `"license": "Apache-2.0"`, `"repository"` pointing at
  `git+https://github.com/tick-ai/coverage-drop.git`, a few `keywords`, and no dependencies of any
  kind.
* `test/coverage-drop.test.mjs`: your own tests, with `node:test`, run by `node --test`. They build
  their LCOV files and diffs in code and need no `git`.

`LICENSE` (Apache-2.0) and `docs/the-job.md` (this text) are given and stay exactly as they are. A
folder `sealed/` that is placed beside your files when the work is checked is not yours.

## How it is run

    node coverage-drop.mjs <base.info> <head.info> [--diff <file>] [--root <prefix>]... [--json | --markdown]
                           [--fail-on-drop <points>] [--fail-on-untested]

* `<base.info>` is the coverage report of the base branch (before), `<head.info>` the report of the
  change (after). Exactly two such arguments are needed. They are read as UTF-8.
* `--diff <file>`: the change as a unified diff, the output of `git diff` (format below). Without
  it the report has no untested-lines part. When given more than once, the last one counts.
* `--root <prefix>`: a path prefix stripped from the file paths of both coverage reports (path rules
  below). It may be given more than once.
* `--json`: print the report as one JSON object (below), and nothing else on stdout.
* `--markdown`: print the report as Markdown for a pull request comment (below).
* Without `--json` and `--markdown`: print the plain report (below).
* `--fail-on-drop <points>`: exit with status 1 when the total line coverage dropped by **more**
  than `<points>` percentage points. `<points>` is a number written as digits, optionally followed
  by a dot and digits (`5`, `0`, `0.5`). It is compared exactly, as a decimal number, with the
  total's change as printed (two decimals): a drop of exactly `<points>` does not fail. If the
  total's change is `null` (below) this option never fails. When given more than once, the last
  one counts. Without it a drop never fails.
* `--fail-on-untested`: exit with status 1 when at least one changed line is untested (below). It
  needs `--diff`.
* `--help` prints a usage line (it contains `coverage-drop`) on stdout and exits with status 0,
  whatever other arguments there are, provided it is not itself the value of an option.
* Options and files may come in any order. An option's value is the next argument, whatever it
  looks like (the form `--root=/x` is not supported: it is an unknown option).

Exit codes:

| status | when |
|---|---|
| 0 | the report was printed and neither `--fail-on-drop` nor `--fail-on-untested` triggered |
| 1 | the report was printed and at least one of them triggered |
| 2 | usage error |
| 3 | a coverage file or the diff file could not be read (missing, a folder, unreadable) |

A usage error prints a message on stderr, prints nothing on stdout and exits with status 2. These
are usage errors: an unknown option (any argument that starts with `-` and is not listed above, a
lone `-` included); an option that needs a value as the last argument; `--diff` with an empty value;
`--root` with a value that is empty after normalisation (see below: `/`, `.`, `./` and the empty
string are); `--fail-on-drop` with a value that is not of the form above; `--json` together with
`--markdown`; a number of coverage files other than two; `--fail-on-untested` without `--diff`. A
file that cannot be read (status 3) also prints nothing on stdout. The arguments are checked for
usage errors before anything is read: a missing file together with a usage error is a usage error
(status 2). When several files are missing, the message may name any of them.

## Paths

Every path is compared after the same normalisation, which is what makes `./src/a.js`,
`src\a.js` and `/home/ci/work/src/a.js` the same file when `--root /home/ci/work` is given:

1. every `\` is replaced by `/`;
2. the path is split at `/`, every segment that is exactly `.` is removed, and the rest is joined
   with `/` again (`./src/./a.js` becomes `src/a.js`; empty segments are kept: `a//b` stays);
3. for coverage-report paths only: if some `--root` prefix is a prefix of the path followed by a
   `/`, the longest such prefix and that `/` are removed from the front of the path (once). A
   prefix is itself normalised by steps 1 and 2 and then loses its trailing `/` characters. A prefix
   matches whole segments only: `/work` does not match `/work2/a.js`. A path equal to the prefix
   is not stripped. Roots apply to the paths of both reports, whichever report they were meant for.

Paths are compared as they are after this, case-sensitively. A coverage record whose path is empty
after normalisation is ignored. Sorting of paths, wherever it is stated, is by UTF-16 code units
(the order of the JavaScript `<` operator on strings): `B.js` before `a.js`, and `a.js` before
`a/b.js`. A path written in the output is the normalised one.

## The LCOV format it reads

The input is split into lines at `\n`; one `\r` before the `\n` is dropped; a byte-order mark at the
very start is ignored. Lines are used as they are (nothing is trimmed). A line that is not one of
those below, an empty line and a `TN:` line are ignored.

* `SF:<path>` begins a record: `<path>` is the rest of the line. Lines before the first `SF:` line
  are ignored.
* `end_of_record` ends the record. A record that has no `end_of_record` ends at the next `SF:` line
  or at the end of the input, and counts all the same.
* `DA:<line>,<hits>[,<checksum>]`: line `<line>` was executed `<hits>` times. The value after
  `DA:` is split at `,` and must have two or three fields; `<line>` and `<hits>` must be digits
  only (no sign, no decimals, no spaces), and `<line>` must be at least 1. The checksum is ignored.
  A `DA:` line that does not follow this is ignored. A line number is **executed** when at least one
  valid `DA:` line for it has `<hits>` above 0, otherwise it is **not executed**.
* `BRDA:<line>,<block>,<branch>,<taken>`: the value after `BRDA:` is split at `,` and must have
  exactly four fields; `<line>` is digits only and at least 1, `<block>` and `<branch>` are not
  empty, and `<taken>` is digits only or the character `-` (never taken). Otherwise the line is
  ignored. The branch is identified by the text `<line>,<block>,<branch>`; it is **taken** when at
  least one valid `BRDA:` line for the same identity has a number above 0 in `<taken>`.
* A `DA:` or `BRDA:` line belongs to the record it is in: the `SF:` line above it that has not been
  ended. Outside a record it is ignored.
* **Records of the same file are one file.** If the same normalised path begins several records, in
  one report, they are merged: a line or branch that appears in several is one line or branch, and it
  is executed (taken) when it is in any of them. A file with a record but no valid `DA:` line is a
  file with 0 lines.
* **Totals are recomputed.** The lines of a file are the distinct line numbers of its valid `DA:`
  lines, `found`; those executed are `hit`. Its branches are the distinct branch identities, `found`;
  those taken are `hit`. The records `LF`, `LH`, `BRF`, `BRH`, `FN`, `FNDA`, `FNF` and `FNH` are never
  used, and never trusted: a report whose `LF` or `LH` disagrees with its `DA:` lines is read by the
  `DA:` lines. Everything else the tool prints is computed from `found` and `hit`.

**Coverage** of a file or of a total is the object `{"found": F, "hit": H, "percent": P}`.
`P` is `H * 100 / F`, rounded **half up** to two decimals (it is a JSON number, such as `66.67`; for
`1/32` it is `3.13`; for `3/32` it is `9.38`), and it is `null` when `F` is 0. The **change in
points** between two coverages is the difference `after.percent - before.percent` of the two
already rounded percentages (so it has at most two decimals: `66.67 - 57.14` is `9.53`), and it is
`null` when either percent is `null` or either coverage does not exist. A change of zero is `0`.

The **total** of a report is the coverage made from the sums of `found` and of `hit` over all
the files of that report, for lines and, separately, for branches. The total before is the base
report's, the total after the head report's. A report without files has a total with `found` 0
and `percent` `null`.

## The diff format it reads

The diff is the format `git diff` prints (also `git show` and `git log -p`). It is decoded as
UTF-8, split at `\n`, one `\r` before the `\n` is dropped, and a last empty line made by the final
newline is not a line. It does not read combined diffs (`diff --cc`) or diffs made with
`--no-prefix`.

* The reader walks the lines. A line that starts with `diff --git ` (outside a hunk) sets the
  **current file** to none. A line that starts with `+++ ` (outside a hunk) sets the current file
  from its path: the text after `+++ `, cut at its first tab character (git adds a tab after paths
  with spaces), then, if it is `/dev/null`, none; otherwise one leading `b/` is removed if there is
  one, and the path is normalised (path rules, steps 1 and 2 only: no `--root`). A path that is empty
  after that is none. A path that git quotes (it starts with a double quote) is outside this job.
  Every other line outside a hunk, and every `--- ` line outside a hunk, is ignored.
* **Hunks.** A line outside a hunk that begins `@@ -<a>[,<b>] +<c>[,<d>] @@` (decimal numbers; a
  missing `,<b>` or `,<d>` means 1) begins a hunk, wherever it is, and **its length is given by the
  header's counts**, not by what the lines look like: the hunk takes lines until `<b>` old lines and
  `<d>` new lines have been taken. In its body:
  * a line that starts with a space, or an empty line, is a **context line**: one old line and one
    new line;
  * a line that starts with `-` is a **removed line**: one old line;
  * a line that starts with `+` is an **added line**: one new line;
  * a line that starts with `\` (`\ No newline at end of file`) is not a line and counts for
    nothing;
  * the hunk ends as soon as both counts have reached 0, or as soon as a line does not fit what is
    still to come (a `-` when no old line is left, a `+` when no new line is left, a context line
    when either is left at 0, or any other first character). That line is then read as a line
    outside a hunk.
  A removed line whose text starts with `-- ` is shown by git as `--- ...`, and an added line whose
  text starts with `++ ` as `+++ ...`: inside a hunk body they are removed and added lines, never
  headers; only the counts tell.
* **New-file line numbers.** The first new line of a hunk is numbered `<c>`; each context line and
  each added line is one new line, and the next one is numbered one higher; a removed line has no
  number and does not move the count.
* The **changed lines** of a file are the new-file numbers of its added lines, over all the hunks
  of all the sections whose current file is that path. A hunk read while the current file is none
  (a deleted file, a diff with no `+++ ` line) adds nothing. Binary files, renames without edits and
  mode changes have no hunks and change nothing. A line a diff removes is never a changed line.

## Untested changed lines

Given `--diff`, for each file path of the diff that is also in the head coverage report, the
**untested changed lines** are the changed lines of that file whose line number is **not
executed** in the head report (it has a valid `DA:` line, and none of them has hits above 0).

Not findings: a changed line with no `DA:` line (a comment, a blank, a brace: the tool does not
know it is code); a context line, even with 0 hits; a line that is executed; any line of a file that
has no record in the head report (a file that has no coverage record at all is not reported here);
any line of the base report, which the untested part never reads.

The lines of a file are grouped into **ranges**: maximal runs of consecutive whole numbers, in
ascending order: the lines 5, 6, 7, 9, 11, 12 are the ranges `5-7`, `9`, `11-12` (a run of one
line is written as that number alone, a longer run as `first-last`; two lines are `11-12`, not
`11, 12`). Lines that are not consecutive numbers are never joined, whatever lies between them.
Files with no untested changed line are not listed.

## What it prints

All three forms end with a newline.

### `--json`

Exactly one JSON object on stdout (any spacing). **The order of the keys is free**; the order of
the entries of an array is stated. Its fields:

```json
{
  "tool": "coverage-drop",
  "version": "0.1.0",
  "total": {
    "lines": {
      "before": { "found": 7, "hit": 4, "percent": 57.14 },
      "after": { "found": 6, "hit": 4, "percent": 66.67 },
      "change": 9.53
    },
    "branches": {
      "before": { "found": 0, "hit": 0, "percent": null },
      "after": { "found": 0, "hit": 0, "percent": null },
      "change": null
    }
  },
  "files": [
    {
      "file": "src/a.js",
      "status": "changed",
      "lines": { "before": { "found": 4, "hit": 2, "percent": 50 }, "after": { "found": 4, "hit": 3, "percent": 75 }, "change": 25 },
      "branches": { "before": { "found": 0, "hit": 0, "percent": null }, "after": { "found": 0, "hit": 0, "percent": null }, "change": null }
    }
  ],
  "new_files": ["src/e.js"],
  "removed_files": ["src/d.js"],
  "untested": { "count": 3, "files": [{ "file": "src/a.js", "count": 3, "ranges": [{ "start": 2, "end": 3 }, { "start": 20, "end": 20 }] }] },
  "failures": ["drop", "untested"]
}
```

* `total` has `lines` and `branches`, each with `before`, `after` (coverages, never `null`) and
  `change` (a number or `null`).
* `files` has one entry for every file path found in either report, sorted by path. `lines` and
  `branches` each hold `before` and `after` (a coverage, or `null` when the file is not in that
  report) and `change` (number or `null`). `status` is `"added"` (in the head report only),
  `"removed"` (in the base report only), `"unchanged"` (in both, with the same `found` and `hit`
  for lines) or `"changed"` (in both, with a different `found` or `hit` for lines). Only the lines
  decide the status: a change in branches alone is `"unchanged"`.
* `new_files` and `removed_files` list the paths of the added and of the removed files, sorted.
* `untested` is `null` without `--diff`. With it, `untested.count` is the number of untested
  changed lines in all, and `untested.files` the files that have some, sorted by path, each with its
  `count` of lines and its `ranges` (objects with `start` and `end`, whole numbers, `start` at most
  `end`), in ascending order.
* `failures` lists, in this order, `"drop"` when `--fail-on-drop` triggered and `"untested"` when
  `--fail-on-untested` triggered; it is empty when the exit status is 0.

### Plain

Let a **cell** be: `-` for a coverage that does not exist (`null`); `n/a` for a coverage with a
`null` percent; otherwise the percent written with two decimals and a `%` (`75.00%`, `0.50%`,
`100.00%`). Let **points** be: `n/a` for a `null` change; otherwise the change with an explicit
sign and two decimals followed by ` points` (`+9.53 points`, `-5.00 points`), and `0.00 points` for
zero. The **file change** of a file is `new file` when its status is `added`, `removed file` when it
is `removed`, otherwise its line **points**.

```
coverage-drop: total <total before cell> -> <total after cell> (<total points>)
```

Then, if at least one file has a status other than `unchanged`: an empty line, the line `Files:`, and
one line for each such file, in path order: two spaces, `<file>: <before cell> -> <after cell>
(<file change>)`. Then, if `--diff` was given: an empty line, the line `Untested changed lines:
<count>`, and for each file in `untested.files` one line: two spaces, `<file>: <ranges>` where the
ranges are written as above and joined with `, `. For example:

```
coverage-drop: total 57.14% -> 66.67% (+9.53 points)

Files:
  src/a.js: 50.00% -> 75.00% (+25.00 points)
  src/d.js: 50.00% -> - (removed file)
  src/e.js: - -> 0.00% (new file)

Untested changed lines: 3
  src/a.js: 2-3, 20
```

### `--markdown`

```
## coverage-drop: total <total before cell> -> <total after cell> (<total points>)
```

Then, if at least one file has a status other than `unchanged`: an empty line, the lines
`| File | Before | After | Change |` and `|---|---|---|---|`, and one row for each such file in path
order: ``| `<file>` | <before cell> | <after cell> | <file change> |`` (a `|` inside a path is written
`\|`). Then, if `--diff` was given: an empty line, the line `### Untested changed lines (<count>)`,
and, if the count is above 0, an empty line and one bullet for each file in `untested.files`:
``- `<file>`: <ranges>``.

## README: the two closing sections

"Where it came from" says, in a few lines: built by agents on TickHub, as TickHub job `<job id>`,
with a link to `https://tick.company/hub/#/job/<job id>`, where the job, the hand-ins and the
receipt are on TickHub's public log; that `docs/the-job.md` is the job as it was given; and the
line "AI does the work. Tick makes it trustworthy. https://tick.company". The job id is given to
the developer with the job.

"Licence" says: Apache-2.0, Copyright 2026 Parsa Esmaeili, see `LICENSE`.

The README's way to run it today is `npx github:tick-ai/coverage-drop` (and `node coverage-drop.mjs`
from a clone). It is not on npm yet, so the README must not say `npx coverage-drop` works. The
README must not claim more than the tool does: it compares line coverage of two LCOV reports and
reads `git diff` output by the rules above; it does not run tests, does not judge them, and does
not look at files that have no coverage record.
