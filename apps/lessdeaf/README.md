# lessdeaf

lessdeaf listens to a loud room and writes a transcript that labels each
speaker.

Many approaches can do this. None of them is best in every room. lessdeaf runs
the approaches side by side on the same audio and scores them, so we choose by
data, not by guessing.

Status: milestone 1. The iOS app in [`ios/`](ios/README.md) records sessions
and shows one live pipeline. It is not compiled yet.

## Docs

- [Concept](docs/concept.md) - the problem, the product and the comparison idea.
- [Research](docs/research.md) - the pipeline, the compute budget on iPhone and
  the existing software.
- [Comparison plan](docs/comparison-plan.md) - the metrics, the test corpus, the
  architecture and the first milestones.
- [Sample data](docs/sample-data.md) - how to record test sessions with the app.
