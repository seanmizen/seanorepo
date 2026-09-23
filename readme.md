# We in this place

Ok, so I've turned my ancient FE repo into a monorepo. soon we'll have all funky stuff in here.

## Getting started
This monorepo uses yarn 4, and carries its own copy in `.yarn/releases`. any `yarn` you have hands over to it,
even yarn 1, so a fresh clone needs just:

```bash
yarn
```

no yarn at all? `brew install yarn` on a mac, or `sudo apt install yarnpkg` on debian (the command is `yarnpkg` there).
`utils/debbie/2026-09-17/payload/setup-developer-environment.sh` does all of this for you.

## Ways of working
Barely any. this is mine, so I will commit wantonly and whenever I like.
PRs and proper codebase sanitation can be done in other projects.
Do as I say, not as I do...

## Yarn
Everything runs off Yarn 4. if you want a repeatable task, put it in the 'scripts' tag of the 'package.json' in each app.
Not a JS/Node project? it is now. (This is just for script running).
Ideally this makes orchestrating everything from the root.

`yarn workspaces foreach` is very handy so try to keep 

### Standard Yarn Commands
`yarn start` - start is equivalent to 'dev'

`yarn prod` - run in a production configuration

`yarn start:docker` - hot-reload but in a docker container.

`yarn prod:docker` - run in a production configuration. NOTE: this is the actual deployment command on the deployment server.
So to deploy, the repo gets pulled in by the deployment server, and this exact command is run.

Later I might make prod:docker a local-run-prod-config setup, and `yarn deploy` might be the launch-in-anger command. And that might build a docker image and send it to AWS. But that's for a later day.

But you should get the point: it's all Yarn. Even if it's a Go microservice.

### Workspace and docker sanitation
Name your volumes pls
