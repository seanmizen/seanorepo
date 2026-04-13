/**
 * Custom commitlint config for seanorepo.
 * Expected format: [SEAN-{number}] {type}: {description}
 * Example: [SEAN-42] fix: resolve hover flicker on subsection cards
 */

const VALID_TYPES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'test',
  'style',
  'perf',
  'ci',
];

export default {
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^\[SEAN-\d+\]\s+(feat|fix|chore|docs|refactor|test|style|perf|ci):\s+.+$/,
      headerCorrespondence: [],
    },
  },
  plugins: [
    {
      rules: {
        'sean-format': (parsed) => {
          const { header } = parsed;
          const pattern =
            /^\[SEAN-\d+\]\s+(feat|fix|chore|docs|refactor|test|style|perf|ci):\s+.+$/;
          if (!header || !pattern.test(header)) {
            return [
              false,
              `Commit message must match: [SEAN-N] type: description\nValid types: ${VALID_TYPES.join(', ')}\nExample: [SEAN-42] fix: resolve hover flicker`,
            ];
          }
          return [true];
        },
      },
    },
  ],
  rules: {
    'sean-format': [2, 'always'],
  },
};
