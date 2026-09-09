#!/usr/bin/env node
/**
 * Enforces REQ-QUALITY-001 ("one suffix, one meaning") over `data-testid`
 * values under `apps/inside/inside-fe/src`.
 *
 * See `apps/inside/CLAUDE.md` § "Test id conventions" for the vocabulary this
 * checks against. #231 is the shape this exists to catch: `me/project.tsx`
 * rendered every failure — a dead backend included — as `piece-missing` at
 * `severity="info"`, because its branch tested `isError` without narrowing on
 * a specific status. Inspection missed it for months. This makes it a check.
 *
 *   node requirements/check-test-ids.mjs             validate apps/inside/inside-fe/src
 *   node requirements/check-test-ids.mjs <dir>        validate a different directory
 *
 * Uses the TypeScript compiler API for real JSX/AST parsing rather than
 * regex — `typescript` is already a devDependency of inside-fe and inside-be
 * and is hoisted to the workspace root, so this adds nothing new. Everything
 * else is Node stdlib, in the spirit of `requirements/check.mjs`.
 *
 * What this checks (see apps/inside/requirements/quality.md, REQ-QUALITY-001):
 *
 *   1. A `-missing` or `-empty` id rendered from a branch that tests
 *      `isError` without also narrowing on a specific status (e.g.
 *      `.status === 404`) — the exact #231 shape.
 *   2. The same test id string used at two source locations that are not
 *      mutually exclusive branches of one conditional (i.e. could both be
 *      true at once, or live in different files/components entirely).
 *   3. A `testId` handed to `<FailureNotice>` or `<FailureAlert>` — which
 *      are, by construction, failure surfaces — that does not end "failure".
 *   4. Any test id whose last hyphen segment is a plausible synonym for one
 *      of the four reserved suffixes (loading/empty/missing/failure) rather
 *      than the word itself, e.g. "-error" where "-failure" was meant.
 *
 * What this deliberately does NOT check: whether the copy inside an alert is
 * honest. That is inspection, same as before — see #234.
 *
 * Escape hatch: a false positive is silenced with a comment containing
 * `test-id-lint-ignore` on the same line as the attribute, or the line
 * above it, e.g.:
 *
 *   // test-id-lint-ignore: a render crash, not a query state (REQ-FAIL-001)
 *   <Alert severity="error" data-testid="render-error">
 *
 * Documented in apps/inside/CLAUDE.md alongside the suffix table itself.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TARGET = join(ROOT, 'apps/inside/inside-fe/src');

const RESERVED_SUFFIXES = ['loading', 'empty', 'missing', 'failure'];

/**
 * Words that read as a state suffix but are not the reserved one — the same
 * "one word, one meaning" idea `.claude/skills/ste/scripts/ste-lint.py`
 * already applies to prose, applied here to test ids.
 */
const CONFUSABLE = {
  loading: ['pending', 'inflight', 'spinner', 'waiting'],
  empty: ['blank', 'none', 'zero'],
  missing: ['gone', 'deleted', 'notfound', 'unavailable', 'unlisted'],
  failure: ['error', 'fail', 'failed', 'err', 'broken'],
};

const CONFUSABLE_TO_CANONICAL = new Map();
for (const [canonical, words] of Object.entries(CONFUSABLE)) {
  for (const word of words) CONFUSABLE_TO_CANONICAL.set(word, canonical);
}

export const IGNORE_MARKER = 'test-id-lint-ignore';

const EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
const walk = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
};

const lastSegment = (id) => id.split('-').at(-1) ?? id;

/** Assigns each conditional/if node a stable id for branch-path comparison. */
let nodeIdCounter = 0;
const nodeIds = new WeakMap();
const idOf = (node) => {
  if (!nodeIds.has(node)) nodeIds.set(node, ++nodeIdCounter);
  return nodeIds.get(node);
};

/**
 * Walks from `node` up to the root, recording which side of every enclosing
 * ternary or if/else it sits on. Two occurrences that sit on opposite sides
 * of the SAME conditional can never both render at once — that is what makes
 * `breadcrumb-crumb`'s link-vs-text ternary one condition, not two.
 */
const branchPath = (node) => {
  const path = [];
  let current = node;
  let parent = current.parent;
  while (parent) {
    if (ts.isConditionalExpression(parent)) {
      if (current === parent.whenTrue) path.push(`c${idOf(parent)}:true`);
      else if (current === parent.whenFalse)
        path.push(`c${idOf(parent)}:false`);
    } else if (ts.isIfStatement(parent)) {
      if (current === parent.thenStatement) path.push(`i${idOf(parent)}:then`);
      else if (parent.elseStatement && current === parent.elseStatement)
        path.push(`i${idOf(parent)}:else`);
    }
    current = parent;
    parent = current.parent;
  }
  return path;
};

/** True when two branch paths share a conditional but sit on opposite sides. */
const mutuallyExclusive = (pathA, pathB) => {
  const sides = new Map();
  for (const token of pathA) {
    const [condId, side] = token.split(':');
    sides.set(condId, side);
  }
  for (const token of pathB) {
    const [condId, side] = token.split(':');
    if (sides.has(condId) && sides.get(condId) !== side) return true;
  }
  return false;
};

/**
 * Every `const <name> = <expr>` in the file, keyed by name.
 *
 * File-scoped rather than truly block-scoped — a deliberate simplification.
 * The convention this exists to enforce is expressed in a handful of local
 * variables (`missing`, `noProfileYet`) that are already effectively unique
 * within one component's file, and a full scope resolver is a lot of AST for
 * a check that would rather under-flag than hand-parse block scoping wrong.
 */
const collectLocalConsts = (sourceFile) => {
  const map = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      map.set(node.name.text, node.initializer.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return (name) => map.get(name);
};

/**
 * The guard conditions that must hold for `node` to render: every enclosing
 * ternary condition (on the true side), if-statement condition (on the then
 * side) and `&&` left-hand side (on the right side) — the three shapes this
 * codebase actually uses to gate a state surface.
 *
 * A bare identifier guard (`missing ? ... `) is resolved to its declaration's
 * initializer text, so narrowing hidden behind a local variable — the
 * `account/brief.tsx` / `briefs/brief.tsx` / `designer-review.tsx` pattern —
 * is still visible to the `.status` check below.
 */
const collectGuards = (node, resolveLocal) => {
  const guards = [];
  const textOf = (expr) => {
    const text = expr.getText();
    if (ts.isIdentifier(expr)) {
      const resolved = resolveLocal(expr.text);
      if (resolved) return `${text} (${resolved})`;
    }
    return text;
  };

  let current = node;
  let parent = current.parent;
  while (parent) {
    if (ts.isConditionalExpression(parent) && current === parent.whenTrue) {
      guards.push(textOf(parent.condition));
    } else if (ts.isIfStatement(parent) && current === parent.thenStatement) {
      guards.push(textOf(parent.expression));
    } else if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      current === parent.right
    ) {
      guards.push(textOf(parent.left));
    }
    current = parent;
    parent = current.parent;
  }
  return guards;
};

/** Every literal-valued `data-testid` / `testId` occurrence in one file. */
const findOccurrences = (sourceFile, relFile) => {
  const occurrences = [];
  const text = sourceFile.text;
  const lines = text.split('\n');

  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  const isIgnored = (attrNode) => {
    const line = lineOf(attrNode);
    const thisLine = lines[line - 1] ?? '';
    const prevLine = lines[line - 2] ?? '';
    return thisLine.includes(IGNORE_MARKER) || prevLine.includes(IGNORE_MARKER);
  };

  /** A static string, whether written as `"x"`, `'x'` or `` `x` ``. */
  const literalTextOf = (exprNode) =>
    exprNode && ts.isStringLiteralLike(exprNode) ? exprNode.text : null;

  const componentNameFor = (jsxAttribute) => {
    const attrs = jsxAttribute.parent;
    const opening = attrs?.parent;
    const tag = opening?.tagName;
    return tag ? tag.getText(sourceFile) : null;
  };

  const visit = (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (name === 'data-testid' || name === 'testId') {
        let exprNode = node.initializer;
        if (exprNode && ts.isJsxExpression(exprNode)) {
          exprNode = exprNode.expression ?? null;
        }
        const literal = literalTextOf(exprNode);
        // A dynamic value (a variable, a template with substitutions) is not
        // decidable statically — skip it rather than guess.
        if (literal && !isIgnored(node)) {
          occurrences.push({
            id: literal,
            file: relFile,
            line: lineOf(exprNode),
            node: exprNode,
            componentName: name === 'testId' ? componentNameFor(node) : null,
          });
        }
      }
    } else if (ts.isPropertyAssignment(node)) {
      const nameNode = node.name;
      const key = ts.isStringLiteral(nameNode)
        ? nameNode.text
        : ts.isIdentifier(nameNode)
          ? nameNode.text
          : null;
      if (key === 'data-testid') {
        const literal = literalTextOf(node.initializer);
        if (literal && !isIgnored(node)) {
          occurrences.push({
            id: literal,
            file: relFile,
            line: lineOf(node.initializer),
            node: node.initializer,
            componentName: null,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return occurrences;
};

/** Rule 1: a `-missing`/`-empty` id gated only by an unnarrowed `isError`. */
const checkNarrowing = (occurrence, resolveLocal) => {
  const suffix = lastSegment(occurrence.id);
  if (suffix !== 'missing' && suffix !== 'empty') return null;

  const guards = collectGuards(occurrence.node, resolveLocal);
  const combined = guards.join(' && ');
  if (!/\bisError\b/.test(combined)) return null;
  if (/\.status\b/.test(combined)) return null;

  return {
    rule: 'unnarrowed-missing-empty',
    file: occurrence.file,
    line: occurrence.line,
    message:
      `"${occurrence.id}" (${occurrence.file}:${occurrence.line}) renders ` +
      'from a branch that tests isError without narrowing on a specific ' +
      'status (e.g. `error instanceof ApiError && error.status === 404`). ' +
      'Every non-matching cause — a 500, a dead tunnel — would render as ' +
      'this id too. This is the #231 shape.',
  };
};

/** Rules 3 & 4: the suffix vocabulary. */
const checkSuffixVocabulary = (occurrence) => {
  const violations = [];
  const suffix = lastSegment(occurrence.id);

  if (
    occurrence.componentName === 'FailureNotice' ||
    occurrence.componentName === 'FailureAlert'
  ) {
    if (suffix !== 'failure') {
      violations.push({
        rule: 'wrong-suffix-for-failure-component',
        file: occurrence.file,
        line: occurrence.line,
        message:
          `"${occurrence.id}" (${occurrence.file}:${occurrence.line}) is ` +
          `the testId of a <${occurrence.componentName}>, which is always ` +
          'a failure surface by construction — it must end "-failure".',
      });
    }
    return violations;
  }

  const canonical = CONFUSABLE_TO_CANONICAL.get(suffix);
  if (canonical) {
    violations.push({
      rule: 'confusable-suffix',
      file: occurrence.file,
      line: occurrence.line,
      message:
        `"${occurrence.id}" (${occurrence.file}:${occurrence.line}) ends ` +
        `"-${suffix}", which reads as a state suffix but is not one of the ` +
        `four this app recognises (${RESERVED_SUFFIXES.join('/')}). Did ` +
        `you mean "-${canonical}"? If this genuinely is not one of those ` +
        `four states, silence with a \`// ${IGNORE_MARKER}: <reason>\` ` +
        'comment on the same or the previous line.',
    });
  }
  return violations;
};

/** Rule 2: the same id at locations that are not mutually exclusive. */
export const checkDuplicates = (occurrences) => {
  const byId = new Map();
  for (const occurrence of occurrences) {
    if (!byId.has(occurrence.id)) byId.set(occurrence.id, []);
    byId.get(occurrence.id).push(occurrence);
  }

  const violations = [];
  for (const [id, occs] of byId) {
    if (occs.length < 2) continue;

    let allExclusive = true;
    for (let i = 0; i < occs.length && allExclusive; i++) {
      for (let j = i + 1; j < occs.length; j++) {
        if (
          !mutuallyExclusive(branchPath(occs[i].node), branchPath(occs[j].node))
        ) {
          allExclusive = false;
          break;
        }
      }
    }

    if (!allExclusive) {
      const locations = occs.map((o) => `${o.file}:${o.line}`).join(', ');
      violations.push({
        rule: 'duplicate-id',
        file: occs[0].file,
        line: occs[0].line,
        message:
          `"${id}" is used at ${occs.length} locations that are not all ` +
          `mutually exclusive branches of one condition: ${locations}. ` +
          'One test id marks one condition — REQ-QUALITY-001.',
      });
    }
  }
  return violations;
};

/** Parses one file's source and returns its occurrences and per-file violations. */
export const checkSource = (fileNameForParsing, sourceText, relFile) => {
  const sourceFile = ts.createSourceFile(
    fileNameForParsing,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const occurrences = findOccurrences(
    sourceFile,
    relFile ?? fileNameForParsing,
  );
  const resolveLocal = collectLocalConsts(sourceFile);

  const violations = [];
  for (const occurrence of occurrences) {
    const narrowing = checkNarrowing(occurrence, resolveLocal);
    if (narrowing) violations.push(narrowing);
    violations.push(...checkSuffixVocabulary(occurrence));
  }
  return { occurrences, violations };
};

const main = () => {
  const targetArg = process.argv[2];
  const target = targetArg ? resolve(process.cwd(), targetArg) : DEFAULT_TARGET;

  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`test id convention check: no such directory: ${target}`);
    process.exitCode = 1;
    return;
  }

  const files = walk(target);
  const allOccurrences = [];
  const allViolations = [];

  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    const relFile = relative(ROOT, file);
    const { occurrences, violations } = checkSource(file, sourceText, relFile);
    allOccurrences.push(...occurrences);
    allViolations.push(...violations);
  }

  allViolations.push(...checkDuplicates(allOccurrences));

  if (allViolations.length > 0) {
    allViolations.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    );
    console.error(
      `test id convention check: ${allViolations.length} violation(s)\n`,
    );
    for (const violation of allViolations) {
      console.error(`  [${violation.rule}] ${violation.message}`);
    }
    console.error(
      '\nSee "Test id conventions" (REQ-QUALITY-001) in apps/inside/CLAUDE.md. ' +
        `A false positive is silenced with a ` +
        `\`// ${IGNORE_MARKER}: <reason>\` comment on the same or the ` +
        'previous line.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `test id convention check: ${allOccurrences.length} test id(s) checked across ${files.length} file(s), 0 violations.`,
    );
  }
};

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
