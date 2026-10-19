"""Freeze each replayed stage into the story as a self-contained sample.

Only import paths change. Anything the story never touched (params.ts, the
photo, site components, features, providers, hooks, index.css) stays a live
import, so the frozen copies hold just the code that the story is about."""
import re
import shutil
from pathlib import Path

OUT = Path('/tmp/claude-1000/-home-sean-projects-seanorepo/015ead16-47ee-48d4-8977-e4a6dc3b5ee4/scratchpad/replay/out')
DEST = Path('/home/sean/projects/seanorepo-736/apps/seanmizen.com/src/features/intentionality/stories/shader')

STAGES = [
    ('s00-start', 's00', 0),
    ('s01-projects-link', 's01', 1),
    ('s03-singularity', 's03', 3),
    ('s04-core-noise', 's04', 4),
    ('s05-throw-panel', 's05', 5),
    ('s06-one-timeline', 's06', 6),
    ('s07-content-mask', 's07b', 7),
    ('s08-venom', 's08', 8),
]

LIVE_SHADER = '@/components/shader-ripple'
LOCAL_COMPONENTS = {'HomeLi': 'home-li', 'ShaderRipple': 'shader-ripple', 'Portrait': 'portrait'}


def sub(text, old, new, count=1):
    assert text.count(old) == count, (old, text.count(old))
    return text.replace(old, new)


def split_components_import(text, prefix):
    """Send the names the story froze to their local copies, and keep the
    rest on the live '@/components' barrel."""
    m = re.search(r"import \{([^}]*)\} from '@/components';\n", text)
    assert m, 'no @/components import'
    names = [n.strip() for n in m.group(1).split(',') if n.strip()]
    live = [n for n in names if n not in LOCAL_COMPONENTS]
    local = [n for n in names if n in LOCAL_COMPONENTS]
    lines = []
    if live:
        lines.append(f"import {{ {', '.join(live)} }} from '@/components';\n")
    for n in local:
        lines.append(f"import {{ {n} }} from '{prefix}components/{LOCAL_COMPONENTS[n]}';\n")
    return text[:m.start()] + ''.join(lines) + text[m.end():]


LAYOUT_IMPORTS = {
    'simple': """import type { FC } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { Portrait } from './components/portrait';
""",
    'flight': """import type { FC } from 'react';
import { useContext, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { LastUpdated, ThemeToggle } from '@/components';
import { ThemeContext } from '@/providers';
import { Portrait } from './components/portrait';
import type { ShaderRippleHandle } from './components/shader-ripple';
import { FlightPanel, useFlight } from './flight-panel';
""",
    'eat': """import type { FC } from 'react';
import { useContext, useRef } from 'react';
import { Outlet, useMatch } from 'react-router-dom';
import { LastUpdated, ThemeToggle } from '@/components';
import { ThemeContext } from '@/providers';
import { Portrait } from './components/portrait';
import { EatPanel, useEat } from './eat-panel';
""",
}


def freeze(name, snap, number):
    src = OUT / snap
    dest = DEST / name
    # Never delete a stage folder: skip one that exists.
    if dest.exists():
        print(f'{name}: exists, skipped')
        return
    (dest / 'components').mkdir(parents=True)

    # The shader: every file but params.ts and the images.
    shader = dest / 'components/shader-ripple'
    shader.mkdir()
    for f in sorted((src / 'components/shader-ripple').iterdir()):
        if f.name == 'params.ts' or f.suffix in ('.jpeg', '.png'):
            continue
        text = f.read_text()
        text = text.replace("from './params'", f"from '{LIVE_SHADER}/params'")
        text = text.replace("export * from './params';", f"export * from '{LIVE_SHADER}/params';")
        text = text.replace("from './IMG_4011_crop2.jpeg'", f"from '{LIVE_SHADER}/IMG_4011_crop2.jpeg'")
        text = text.replace("from './particle2.png'", f"from '{LIVE_SHADER}/particle2.png'")
        (shader / f.name).write_text(text)

    # HomeLi, and the portrait once it exists.
    for comp in ('home-li', 'portrait'):
        if not (src / 'components' / comp).exists():
            continue
        (dest / 'components' / comp).mkdir()
        for f in (src / 'components' / comp).iterdir():
            text = f.read_text()
            text = text.replace("from '../accordion'", "from '@/components/accordion'")
            text = text.replace("from '../entity-list'", "from '@/components/entity-list'")
            (dest / 'components' / comp / f.name).write_text(text)

    # The home page.
    (dest / 'routes/home').mkdir(parents=True)
    home = (src / 'app/routes/home/home.tsx').read_text()
    home = split_components_import(home, '../../')
    home = home.replace(f"from '{LIVE_SHADER}'", "from '../../components/shader-ripple'")
    (dest / 'routes/home/home.tsx').write_text(home)

    # The projects page, or /apps before it was renamed.
    page = 'apps' if number == 0 else 'projects'
    (dest / 'routes' / page).mkdir()
    for f in (src / 'app/routes' / page).iterdir():
        if f.name != 'index.ts':
            shutil.copy(f, dest / 'routes' / page / f.name)

    # The tuning panel, while there was one.
    for panel in ('flight-panel.tsx', 'eat-panel.tsx'):
        if (src / 'app' / panel).exists():
            text = (src / 'app' / panel).read_text()
            text = sub(text, f"from '{LIVE_SHADER}';", "from './components/shader-ripple';", 2)
            text = sub(text, "from './routes/hire-lab/hire-lab.module.css';",
                       "from '@/app/routes/hire-lab/hire-lab.module.css';")
            (dest / panel).write_text(text)

    # The layout route, cut out of that stage's app.tsx.
    if number > 0:
        app = (src / 'app/app.tsx').read_text()
        start = min(i for i in (app.find('/* The pages that share'), app.find('/* What the home page')) if i >= 0)
        end = app.index('const App: FC')
        block = app[start:end].rstrip() + '\n'
        component = 'Layout' if 'const Layout' in block else 'WithPortrait'
        kind = 'eat' if 'EatPanel' in block else 'flight' if 'FlightPanel' in block else 'simple'
        (dest / 'layout.tsx').write_text(
            LAYOUT_IMPORTS[kind] + '\n' + block + f'\nexport {{ {component} }};\n')
    print(f'{name}: frozen from {snap}')


for stage in STAGES:
    freeze(*stage)
