# We in this place

Ok, so I've turned my ancient FE repo into a monorepo. soon we'll have all funky stuff in here.

## Getting started
This monorepo uses yarn ^4.0.0, which is a bit tricky. running 'yarn install' on a new repo defaults to ^1.0.0
so you'll need to use corepack, a strange node thing, to allow the relevant yarn 4 to be auto-installed.

```bash
corepack enable
corepack prepare
yarn
```