#!/usr/bin/env node
/*
  Freezes the site's shader code, as it is now, into a new stage of an
  intentionality story.

    node scripts/freeze-stage.mjs <story> <stage> [out]

  For example `node scripts/freeze-stage.mjs shader s09-tendrils` makes
  src/features/intentionality/stories/shader/s09-tendrils. Run it from the
  app folder. `out` replaces the stories folder, for a dry run.

  The stage gets copies of the files the story is about: the shader, the
  portrait, HomeLi, the home and projects pages, the tuning panel, and the
  layout route cut out of app.tsx. Only import paths change. Everything
  else (params.ts, the photo, site components, features, hooks, index.css)
  stays a live import. A tuning panel is set to show in the sample, with a
  storage key of its own. It also writes the stage's main.tsx. It never
  writes over a stage that exists.

  Then add the stage to the story's story.ts, with Sean's message verbatim.
*/
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const [story, stage, out = 'src/features/intentionality/stories'] =
  process.argv.slice(2);
if (!story || !stage) {
  console.error('Usage: node scripts/freeze-stage.mjs <story> <stage> [out]');
  process.exit(1);
}

const SRC = 'src';
const LIVE_SHADER = '@/components/shader-ripple';
const LOCAL_COMPONENTS = {
  HomeLi: 'home-li',
  ShaderRipple: 'shader-ripple',
  Portrait: 'portrait',
};
const dest = join(out, story, stage);
if (existsSync(dest)) {
  console.error(`${dest} exists. Stages are never written over.`);
  process.exit(1);
}

const read = (path) => readFileSync(join(SRC, path), 'utf8');
const write = (path, text) => {
  mkdirSync(join(dest, path, '..'), { recursive: true });
  writeFileSync(join(dest, path), text);
};
const replaceOnce = (text, from, to, count = 1) => {
  const found = text.split(from).length - 1;
  if (found !== count) {
    throw new Error(`Expected ${count} of "${from}", found ${found}`);
  }
  return text.replaceAll(from, to);
};

/* Send the names the story freezes to their local copies, and keep the
   rest on the live '@/components' barrel. */
const splitComponentsImport = (text, prefix) => {
  const match = text.match(/import \{([^}]*)\} from '@\/components';\n/);
  if (!match) throw new Error('No @/components import');
  const names = match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const live = names.filter((name) => !(name in LOCAL_COMPONENTS));
  const local = names.filter((name) => name in LOCAL_COMPONENTS);
  const lines = [
    ...(live.length
      ? [`import { ${live.join(', ')} } from '@/components';\n`]
      : []),
    ...local.map(
      (name) =>
        `import { ${name} } from '${prefix}components/${LOCAL_COMPONENTS[name]}';\n`,
    ),
  ];
  return text.replace(match[0], lines.join(''));
};

// The shader: every file but params.ts and the images.
for (const name of readdirSync(join(SRC, 'components/shader-ripple'))) {
  if (name === 'params.ts' || /\.(jpe?g|png)$/.test(name)) continue;
  const text = read(`components/shader-ripple/${name}`)
    .replaceAll("from './params'", `from '${LIVE_SHADER}/params'`)
    .replaceAll(
      "export * from './params';",
      `export * from '${LIVE_SHADER}/params';`,
    )
    .replaceAll(
      "from './IMG_4011_crop2.jpeg'",
      `from '${LIVE_SHADER}/IMG_4011_crop2.jpeg'`,
    )
    .replaceAll(
      "from './particle2.png'",
      `from '${LIVE_SHADER}/particle2.png'`,
    );
  write(`components/shader-ripple/${name}`, text);
}

// HomeLi and the portrait.
for (const component of ['home-li', 'portrait']) {
  for (const name of readdirSync(join(SRC, 'components', component))) {
    const text = read(`components/${component}/${name}`)
      .replaceAll("from '../accordion'", "from '@/components/accordion'")
      .replaceAll("from '../entity-list'", "from '@/components/entity-list'");
    write(`components/${component}/${name}`, text);
  }
}

// The home and projects pages.
write(
  'routes/home/home.tsx',
  splitComponentsImport(read('app/routes/home/home.tsx'), '../../').replaceAll(
    `from '${LIVE_SHADER}'`,
    "from '../../components/shader-ripple'",
  ),
);
for (const name of readdirSync(join(SRC, 'app/routes/projects'))) {
  if (name !== 'index.ts') {
    write(`routes/projects/${name}`, read(`app/routes/projects/${name}`));
  }
}

// The tuning panel, if there is one.
const panels = readdirSync(join(SRC, 'app')).filter((name) =>
  name.endsWith('-panel.tsx'),
);
for (const panel of panels) {
  let text = read(`app/${panel}`);
  const imports = text.split(`from '${LIVE_SHADER}';`).length - 1;
  text = replaceOnce(
    text,
    `from '${LIVE_SHADER}';`,
    "from './components/shader-ripple';",
    imports,
  );
  text = replaceOnce(
    text,
    "from './routes/hire-lab/hire-lab.module.css';",
    "from '@/app/routes/hire-lab/hire-lab.module.css';",
  );
  // A tuning panel is a beat of the story, so a sample always shows it. Its
  // own storage key makes each stage open on that stage's defaults.
  text = replaceOnce(
    text,
    "const DEV = process.env.NODE_ENV === 'development';\n",
    '// Changed for the story: on the site the panel showed only on the dev\n' +
      '// server. In a story sample it always shows.\n' +
      'const DEV = true;\n',
  );
  text = text.replace(
    /const STORAGE_KEY = '([^']+)';/,
    `const STORAGE_KEY = '$1:${story}-${stage}';`,
  );
  write(panel, text);
}

// The layout route, cut out of app.tsx: from its comment to `const App`.
const app = read('app/app.tsx');
const start = app.indexOf('/* What the home page');
const end = app.indexOf('const App: FC');
if (start < 0 || end < 0) throw new Error('No layout route in app.tsx');
const block = `${app.slice(start, end).trimEnd()}\n`;
const panelImports = panels.map((panel) => {
  const exports = readFileSync(join(SRC, 'app', panel), 'utf8').match(
    /export \{ ([^}]*) \};/,
  );
  return `import { ${exports[1]} } from './${panel.replace('.tsx', '')}';\n`;
});
const uses = (name) => block.includes(name);
write(
  'layout.tsx',
  [
    "import type { FC } from 'react';\n",
    `import { ${['useContext', 'useRef'].filter(uses).join(', ')} } from 'react';\n`,
    "import { Outlet, useMatch } from 'react-router-dom';\n",
    `import { ${['LastUpdated', 'ThemeToggle'].filter(uses).join(', ')} } from '@/components';\n`,
    "import { ThemeContext } from '@/providers';\n",
    "import { Portrait } from './components/portrait';\n",
    ...(uses('ShaderRippleHandle')
      ? [
          "import type { ShaderRippleHandle } from './components/shader-ripple';\n",
        ]
      : []),
    ...panelImports,
    '\n',
    block,
    '\nexport { Layout };\n',
  ].join(''),
);

// The stage's entry point.
write(
  'main.tsx',
  `/* Stage ${stage} of the ${story} story, as a page of its own. This is the
   only file in the folder written for the story. The rest are copies of the
   site's code at this stage, with only their import paths changed${
     panels.length
       ? ', and\n   the tuning panel set to show outside the dev server'
       : ''
   }. */
import { Route } from 'react-router-dom';
import { mountSample } from '@/features/intentionality/mount-sample';
import { Layout } from './layout';
import { Home } from './routes/home/home';
import { Projects } from './routes/projects/projects';

mountSample(
  <Route element={<Layout />}>
    <Route path="/projects" element={<Projects />} />
    <Route path="/*" element={<Home />} />
  </Route>,
);
`,
);

console.log(`Froze ${dest}. Run yarn fix, then add the stage to story.ts.`);
