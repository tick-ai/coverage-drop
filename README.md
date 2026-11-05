# coverage-drop

coverage-drop compares two LCOV coverage reports, file by file and in total, and, given the change's diff, lists the added lines that no test runs.

```sh
npx github:tick-ai/coverage-drop base.info head.info --diff change.diff
```

```
coverage-drop: total 50.00% -> 50.00% (0.00 points)

Files:
  src/a.js: 50.00% -> 40.00% (-10.00 points)
  src/d.js: 50.00% -> - (removed file)
  src/e.js: - -> 100.00% (new file)

Untested changed lines: 3
  src/a.js: 2-3, 20
```

Here `base.info` is the coverage of the base branch, `head.info` the coverage of the change, and `change.diff` the output of `git diff`. Add `--markdown` for a pull request comment, `--json` for a program, `--fail-on-drop 1` and `--fail-on-untested` to fail the build.

## Why

Agents change code faster than they test it. A coverage gate in CI for every pull request asks two plain questions: did the coverage go down, in each file and in total; and which of the lines this change added does no test execute? coverage-drop answers both from two files, by rules that are written down below, so that two people (or two tools) get the same report from the same files.

It reads the LCOV format, which nearly every coverage tool can write (c8, nyc, Jest, Vitest, coverage.py with lcov output, Go tooling through converters), so it works for any repository in any language.

What it does **not** do: it never runs tests and never judges whether a test is good. It compares **line coverage** (and shows branch numbers in `--json`) of two LCOV reports and reads `git diff` output by the rules below. A file that has no coverage record is not looked at.

It needs Node 22 or later and nothing else: one file, no dependencies, no network.

## Run it

```sh
npx github:tick-ai/coverage-drop <base.info> <head.info> [options]
node coverage-drop.mjs <base.info> <head.info> [options]      # from a clone
```

It is not on npm yet, so there is no `npx coverage-drop`.

```
node coverage-drop.mjs <base.info> <head.info> [--diff <file>] [--root <prefix>]... [--json | --markdown]
                       [--fail-on-drop <points>] [--fail-on-untested]
```

| Option | Meaning |
|---|---|
| `<base.info>` `<head.info>` | The LCOV reports of the base branch (before) and of the change (after). Exactly two, read as UTF-8. |
| `--diff <file>` | The change as a unified diff, the output of `git diff` (also `git show`, `git log -p`). Without it the report has no untested-lines part. The last one given counts. |
| `--root <prefix>` | A path prefix stripped from the file paths of both coverage reports. May be given more than once. |
| `--json` | Print the report as one JSON object, and nothing else on stdout. |
| `--markdown` | Print the report as Markdown for a pull request comment. (`--json` and `--markdown` cannot be combined.) |
| `--fail-on-drop <points>` | Exit with status 1 when the total line coverage dropped by **more** than `<points>` percentage points (`5`, `0`, `0.5`). A drop of exactly `<points>` does not fail. The last one given counts. |
| `--fail-on-untested` | Exit with status 1 when at least one changed line is untested. Needs `--diff`. |
| `--help` | Print a usage line and exit with status 0. |

Options and files may come in any order. An option's value is the next argument, whatever it looks like; the form `--root=/x` is not supported (it is an unknown option).

### Exit codes

| Status | When |
|---|---|
| 0 | The report was printed and neither `--fail-on-drop` nor `--fail-on-untested` triggered. |
| 1 | The report was printed and at least one of them triggered. |
| 2 | Usage error: a message on stderr, nothing on stdout. |
| 3 | A coverage file or the diff file could not be read (missing, a folder, unreadable): a message on stderr, nothing on stdout. |

Usage errors are an unknown option (any argument that starts with `-` and is not listed above, a lone `-` included); an option that needs a value as the last argument; `--diff` with an empty value; `--root` with a value that is empty after normalisation (`/`, `.`, `./`, the empty string); `--fail-on-drop` with a value that is not digits, optionally followed by a dot and digits; `--json` together with `--markdown`; a number of coverage files other than two; `--fail-on-untested` without `--diff`. They are checked before anything is read, so a missing file together with a usage error is a usage error.

## What the report says

### Plain

```
coverage-drop: total <before> -> <after> (<points>)

Files:
  <file>: <before> -> <after> (<file change>)

Untested changed lines: <count>
  <file>: <ranges>
```

* A coverage cell is `-` when the file is not in that report, `n/a` when it has no lines, otherwise the percentage with two decimals (`75.00%`).
* Points are `n/a` when there is nothing to compare, otherwise signed with two decimals (`+9.53 points`, `-5.00 points`, `0.00 points`).
* `Files:` lists the files that are not `unchanged`, in path order; the change is `new file` for a file only in the head report, `removed file` for a file only in the base report, otherwise the change of its line coverage. The block is left out when every file is unchanged.
* The untested part appears only with `--diff`. Ranges are written `5-7, 9, 11-12`.

### Markdown

```markdown
## coverage-drop: total 50.00% -> 50.00% (0.00 points)

| File | Before | After | Change |
|---|---|---|---|
| `src/a.js` | 50.00% | 40.00% | -10.00 points |
| `src/d.js` | 50.00% | - | removed file |
| `src/e.js` | - | 100.00% | new file |

### Untested changed lines (3)

- `src/a.js`: 2-3, 20
```

### JSON

One object (key order is free; the order of array entries is stated):

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

* `files` has one entry for every path in either report, sorted by path. `before` / `after` are `null` when the file is not in that report. `status` is `added` (head only), `removed` (base only), `unchanged` (both, same `found` and `hit` for lines) or `changed`. Only lines decide the status: a change in branches alone is `unchanged`.
* `new_files` and `removed_files` are sorted.
* `untested` is `null` without `--diff`.
* `failures` lists, in this order, `"drop"` and `"untested"` when the option triggered; it is empty when the status is 0.

## The rules

### Rounding

The coverage of a file or a total is `{found, hit, percent}`. `percent` is `hit * 100 / found` rounded **half up** to two decimals (`1/32` is `3.13`, `3/32` is `9.38`), and `null` when `found` is 0. The **change** is the difference of the two already rounded percentages (`66.67 - 57.14` is `9.53`), and `null` when either is `null` or the file is not in both reports. `--fail-on-drop` compares exactly, as a decimal number, with the total's change as printed.

The total is made from the sums of `found` and `hit` over all files of a report, for lines and, separately, for branches.

### Paths

Every path is normalised the same way, so that `./src/a.js`, `src\a.js` and `/home/ci/work/src/a.js` are the same file when `--root /home/ci/work` is given:

1. every `\` becomes `/`;
2. the path is split at `/`, every segment that is exactly `.` is removed, and the rest is joined with `/` (`./src/./a.js` becomes `src/a.js`; empty segments stay: `a//b` stays);
3. coverage-report paths only: if some `--root` prefix (normalised by 1 and 2, trailing `/` removed) is a prefix of the path followed by a `/`, the longest such prefix and that `/` are removed, once. Whole segments only: `/work` does not match `/work2/a.js`. A path equal to the prefix is not stripped. Roots apply to both reports.

Paths are then compared case-sensitively and sorted by UTF-16 code units (`B.js` before `a.js`, `a.js` before `a/b.js`). A coverage record whose path is empty after this is ignored. Paths of the diff get steps 1 and 2 only.

### The LCOV reader

Lines are split at `\n`, one `\r` before it is dropped, a byte-order mark at the start is ignored, and nothing is trimmed. `SF:<path>` begins a record, `end_of_record` ends it; a record with no `end_of_record` ends at the next `SF:` or at the end of the input. Anything else that is not listed here (`TN:`, unknown lines) is ignored.

* `DA:<line>,<hits>[,<checksum>]` with two or three fields, `<line>` and `<hits>` digits only and `<line>` at least 1. Otherwise the line is ignored. A line is **executed** when some valid `DA:` line for it has hits above 0.
* `BRDA:<line>,<block>,<branch>,<taken>` with exactly four fields, `<line>` digits and at least 1, `<block>` and `<branch>` not empty, `<taken>` digits or `-`. A branch is identified by `<line>,<block>,<branch>` and is **taken** when some valid line for it has a number above 0.
* Records of the same (normalised) file are one file: a line or branch that appears in several is one, executed (taken) when it is in any of them. A file with a record but no valid `DA:` line is a file with 0 lines.
* **Totals are recomputed** from the `DA:` and `BRDA:` lines. `LF`, `LH`, `BRF`, `BRH`, `FN`, `FNDA`, `FNF` and `FNH` are never used.

### The diff reader

The diff is decoded as UTF-8 and split at `\n` (one `\r` before it dropped). It does not read combined diffs (`diff --cc`) or diffs made with `--no-prefix`.

* `diff --git ` outside a hunk sets the current file to none. `+++ <path>` outside a hunk sets it from the text after `+++ `, cut at the first tab (git adds one after paths with spaces); `/dev/null` is none, otherwise one leading `b/` is removed and the path is normalised. Paths that git quotes are not supported.
* A hunk begins at `@@ -a[,b] +c[,d] @@` and its length is given by the header's counts (a missing count is 1), not by what lines look like: a removed line `--- x` or an added line `+++ x` inside a hunk is a removed or added line, never a header. A context line (a space, or an empty line) is one old and one new line, `-` one old line, `+` one new line, `\` (no newline marker) nothing. The hunk ends when both counts reach 0, or when a line does not fit what is still to come; that line is then read outside the hunk.
* New-file line numbers start at `c`; context and added lines advance them, removed lines do not.
* The **changed lines** of a file are the new-file numbers of its added lines. A hunk read while there is no current file (a deleted file) adds nothing. Binary files, renames without edits and mode changes have no hunks and change nothing.

### Untested changed lines

For each file of the diff that is also in the head report, the untested changed lines are the changed lines that have a valid `DA:` line in the head report and none of them has hits above 0. Not findings: a changed line with no `DA:` line (a comment, a blank, a brace: coverage-drop cannot know it is code); a context line, even with 0 hits; an executed line; any line of a file with no record in the head report. Lines are grouped into ranges of consecutive numbers (`5-7, 9, 11-12`).

## GitHub Actions

This workflow produces both reports with [c8](https://github.com/bcoe/c8), posts the Markdown report as a pull request comment, and fails the job when the total drops by more than one point or a changed line is untested. Change the two coverage steps for your language: all that coverage-drop needs is an LCOV file for the base and one for the change.

```yaml
name: coverage-drop
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  coverage:
    runs-on: ubuntu-latest
    env:
      BASE_REF: ${{ github.base_ref }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Coverage of the base branch
        run: |
          git worktree add "$RUNNER_TEMP/base" "origin/$BASE_REF"
          cd "$RUNNER_TEMP/base"
          npm ci
          npx c8 --reporter=lcovonly --report-dir=coverage npm test
          cp coverage/lcov.info "$GITHUB_WORKSPACE/base.info"

      - name: Coverage of the change
        run: |
          npm ci
          npx c8 --reporter=lcovonly --report-dir=coverage npm test
          cp coverage/lcov.info head.info

      - name: Compare
        id: compare
        run: |
          git diff "origin/$BASE_REF...HEAD" > change.diff
          set +e
          npx github:tick-ai/coverage-drop base.info head.info \
            --diff change.diff \
            --root "$GITHUB_WORKSPACE" --root "$RUNNER_TEMP/base" \
            --markdown --fail-on-drop 1 --fail-on-untested > report.md
          echo "status=$?" >> "$GITHUB_OUTPUT"

      - name: Comment on the pull request
        if: always() && (steps.compare.outputs.status == '0' || steps.compare.outputs.status == '1')
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment "${{ github.event.pull_request.number }}" --body-file report.md

      - name: Fail when coverage-drop said so
        if: steps.compare.outputs.status != '0'
        run: exit 1
```

The `--root` options turn absolute paths (if your coverage tool writes them) into repository-relative ones; the paths of `git diff` are already relative. The step "Compare" keeps going when coverage-drop fails, so that the comment is posted first and the job fails after it. After a usage or read error (status 2 or 3) there is no report to post, and the job still fails.

## Where it came from

coverage-drop was built by agents on TickHub, as TickHub job `0c9de11f-b1f2-4979-b0fb-9e3e237743f0`. The job, the hand-ins and the receipt are on TickHub's public log: https://tick.company/hub/#/job/0c9de11f-b1f2-4979-b0fb-9e3e237743f0. The file `docs/the-job.md` is the job as it was given.

AI does the work. Tick makes it trustworthy. https://tick.company

## Licence

Apache-2.0, Copyright 2026 Parsa Esmaeili, see `LICENSE`.
