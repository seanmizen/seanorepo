// UX rubric — single source of truth for the 10 dimensions Claude scores
// when reviewing a captured run.
//
// Why a shared module: both the deterministic test suite (where it can
// assert on, say, decisionsToConversion === 0 by inspecting a flow trace)
// and the `/ux-review` skill (where Claude reads screenshots + aria
// snapshots and assigns 1–5 per dimension) import from this file. If the
// rubric ever drifts between the two, scorecards stop being comparable.
//
// Each dimension answers one of Sean's four UX questions in measurable
// form. The four questions:
//   1. "is this easy?"           — first-paint clarity, CTA salience
//   2. "was this logical?"       — flow logic, decisions-to-conversion
//   3. "did this require zero thought?" — wait-state honesty,
//                                          time-to-success, result block
//                                          sufficiency
//   4. "am I too restricted by the file picker?" — file picker
//                                                  permissiveness, error
//                                                  legibility, restrictions log

export type ScoreLevel = 1 | 2 | 3 | 4 | 5;

export interface RubricDimension {
  /** stable key — used in JSON scorecards, never rename */
  key: string;
  /** human-readable name for markdown */
  name: string;
  /** which of Sean's 4 UX questions this dimension serves */
  question:
    | 'is-this-easy'
    | 'was-this-logical'
    | 'zero-thought'
    | 'picker-not-too-restrictive';
  /** one-line description for prompts and scorecards */
  description: string;
  /** what 1, 3, 5 look like — Claude uses these to anchor scoring */
  anchors: {
    1: string;
    3: string;
    5: string;
  };
}

export const RUBRIC: readonly RubricDimension[] = [
  {
    key: 'firstPaintClarity',
    name: 'First-paint clarity',
    question: 'is-this-easy',
    description:
      'Within 1 second of paint, can a cold visitor name what the site does and what to do next?',
    anchors: {
      1: 'Hero is ambiguous; no headline, no CTA, branding only.',
      3: 'Headline names the product but the next action is two scrolls or one hover away.',
      5: 'Single-glance: headline + drop zone + visible CTA all above the fold; the next action is unmissable.',
    },
  },
  {
    key: 'ctaSalience',
    name: 'CTA salience',
    question: 'is-this-easy',
    description:
      'How obvious is the primary action versus competing UI? The drop zone or convert button must dominate visual hierarchy.',
    anchors: {
      1: 'Multiple equally-weighted buttons; primary action looks like a secondary link.',
      3: 'Primary CTA is identifiable but competes with a secondary action of similar weight.',
      5: 'Primary CTA is unmistakably the loudest element on the page (size, contrast, position).',
    },
  },
  {
    key: 'decisionsToConversion',
    name: 'Decisions to conversion',
    question: 'was-this-logical',
    description:
      'Count of choices a user must make between landing and downloading the result. Lower is better. A drag-drop with auto-routing scores 5.',
    anchors: {
      1: 'More than 3 decisions (e.g. format, codec, bitrate, container before any conversion runs).',
      3: 'One required decision (e.g. pick output format from a chip row).',
      5: 'Zero decisions — drop file, hit convert, download. Everything else is optional.',
    },
  },
  {
    key: 'filePickerPermissiveness',
    name: 'File picker permissiveness',
    question: 'picker-not-too-restrictive',
    description:
      'Does the OS file picker show all relevant files, or does an aggressive accept= attribute hide them? Hidden files = user blames the site.',
    anchors: {
      1: 'Picker only shows one extension; user sees their .mov greyed out and bounces.',
      3: 'Accept list covers the common cases but excludes equivalents (e.g. .m4v greyed out).',
      5: 'No accept gating at picker level; routing decided after the file is in hand.',
    },
  },
  {
    key: 'flowLogic',
    name: 'Flow logic',
    question: 'was-this-logical',
    description:
      'Does each step naturally lead to the next? No backtracking, no surprise screens, no "wait, why am I here".',
    anchors: {
      1: 'The flow loops or dead-ends; user has to refresh or navigate manually to continue.',
      3: 'Flow works but a step feels redundant (e.g. confirm-then-confirm-again).',
      5: 'Each screen makes the next screen obvious; no user thought needed to advance.',
    },
  },
  {
    key: 'errorLegibility',
    name: 'Error legibility',
    question: 'picker-not-too-restrictive',
    description:
      'When something fails (unsupported file, network drop, backend error) can a non-technical user understand what to do next?',
    anchors: {
      1: 'Raw stack trace, HTTP status code, or silent failure with no signal.',
      3: 'Plain-English message but no recovery action ("something went wrong").',
      5: 'Plain-English message + a clear recovery action ("we don\'t support .xyz yet — try .abc instead" with a try-again button).',
    },
  },
  {
    key: 'timeToSuccess',
    name: 'Time to success',
    question: 'zero-thought',
    description:
      'Wall-clock seconds from page-load to the user holding the converted file. Includes any wait state. Lower is better.',
    anchors: {
      1: 'Over 30s for a small file, no progress signal during the wait.',
      3: '5–15s with a basic spinner.',
      5: 'Under 5s for a small fixture, with a percent or step counter throughout.',
    },
  },
  {
    key: 'waitStateHonesty',
    name: 'Wait-state honesty',
    question: 'zero-thought',
    description:
      'Does the wait state tell the user what is happening and roughly how long is left? Honest waits feel shorter than dishonest spinners.',
    anchors: {
      1: "Indeterminate spinner with no label; user can't tell if the page is hung.",
      3: 'Spinner with a generic label ("Working…") but no progress or step indicator.',
      5: 'Step-by-step or percent progress with current-step text ("Encoding audio… 60%").',
    },
  },
  {
    key: 'resultBlockSufficiency',
    name: 'Result block sufficiency',
    question: 'zero-thought',
    description:
      'Once the conversion completes, does the result block give the user everything they need without scrolling or thinking? File name, size, download button, "convert another" affordance.',
    anchors: {
      1: 'Just a raw URL; user has to right-click-save-as.',
      3: 'A download button but no filename, size, or "convert another" action.',
      5: 'Filename + size + prominent download + "convert another file" affordance, all in one block.',
    },
  },
  {
    key: 'restrictionsLog',
    name: 'Restrictions log',
    question: 'picker-not-too-restrictive',
    description:
      'Cumulative count of moments in the flow where the UI told the user "you can\'t do that" without an obvious next move. Goal: zero.',
    anchors: {
      1: 'Multiple dead-ends with no recovery path.',
      3: 'One restriction surfaced but with a clear suggestion to try X instead.',
      5: 'Zero restrictions — every blocked path offers an alternative or auto-routes.',
    },
  },
] as const;

/** Total possible score across all 10 dimensions. */
export const MAX_SCORE = RUBRIC.length * 5;

/** Fail threshold for any individual dimension. SEAN-115 will treat
 *  any dim <3 as a self-merge blocker. */
export const FAIL_BELOW = 3;

/** Compose a markdown block describing the rubric — used by the
 *  /ux-review skill to anchor Claude's scoring prompt. */
export function rubricMarkdown(): string {
  const lines: string[] = ['# UX Rubric — 10 dimensions', ''];
  for (const dim of RUBRIC) {
    lines.push(`## ${dim.name} (\`${dim.key}\`)`);
    lines.push(`*Question: ${dim.question}*`);
    lines.push('');
    lines.push(dim.description);
    lines.push('');
    lines.push('**Scoring anchors:**');
    lines.push(`- **1**: ${dim.anchors[1]}`);
    lines.push(`- **3**: ${dim.anchors[3]}`);
    lines.push(`- **5**: ${dim.anchors[5]}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Shape of a per-dimension entry in a scorecard JSON. */
export interface DimensionScore {
  key: string;
  score: ScoreLevel;
  rationale: string;
  evidence?: string[];
}

/** Shape of a complete scorecard — `/ux-review` writes this alongside the
 *  human-readable scorecard.md so future runs can diff programmatically. */
export interface Scorecard {
  flow: string;
  runDir: string;
  capturedAt: string;
  total: number;
  max: number;
  dimensions: DimensionScore[];
  notes?: string;
}
