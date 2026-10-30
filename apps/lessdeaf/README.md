# lessdeaf

lessdeaf listens to a loud room and writes a transcript that labels each
speaker.

Many approaches can do this. None of them is best in every room. lessdeaf runs
the approaches side by side on the same audio and scores them, so we choose by
data, not by guessing.

Status: milestone 1. The iOS app in [`ios/`](ios/README.md) records sessions
and shows one live pipeline. It is not compiled yet. The backend in
[`server/`](#backend) keeps sessions on the homelab.

## Backend

One Bun process on port 4100 (4101 is reserved). It keeps the sessions that
the phone sends: metadata, audio and transcripts. The top of `server/app.ts`
lists the routes.

```bash
yarn workspace lessdeaf start        # local, key "local-dev-lessdeaf-key", data in ./data
yarn workspace lessdeaf start:docker # dev profile in Docker
yarn workspace lessdeaf test         # bun test
```

### Key

Every route except `/api/health` needs `Authorization: Bearer <LESSDEAF_KEY>`.
Reads need it too, because the audio holds the voices of other people.
Without a key of 16 characters or more, the routes answer 503.

On the server, put the key in `apps/lessdeaf/.env`:

```bash
echo "LESSDEAF_KEY=$(openssl rand -hex 24)" > apps/lessdeaf/.env
```

Type the same key in the app, on the **Settings** tab.

### Audio upload

The phone sends audio as numbered chunks of 16-bit PCM, about 5 s each. Each
chunk goes to `PUT /api/sessions/<id>/audio/<seq>`. When the session stops,
`POST .../audio/finish` joins the chunks into `audio.wav`. The phone can send a
chunk or the finish again after a lost response.

### Data

The sessions live in the named volume `lessdeaf_sessions_data`, at
`/data/sessions/<id>/`. Like the other volumes, it exists only on the machine
that runs the prod profile.

### Reach

- On the LAN: `http://lessdeaf.<host>.local`, through `infra/edge`.
- Outside the LAN: no public hostname yet. A tunnel rule and a DNS record
  for `lessdeaf.seanmizen.com` must be added before the phone can upload from
  a pub.

## Docs

- [Concept](docs/concept.md) - the problem, the product and the comparison idea.
- [Research](docs/research.md) - the pipeline, the compute budget on iPhone and
  the existing software.
- [Comparison plan](docs/comparison-plan.md) - the metrics, the test corpus, the
  architecture and the first milestones.
- [Sample data](docs/sample-data.md) - how to record test sessions with the app.
