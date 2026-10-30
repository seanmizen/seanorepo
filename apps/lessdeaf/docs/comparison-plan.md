# Comparison plan

## What we compare

Each **pipeline** is one combination of options:

- Mic setup: phone mic, external mic array, lapel mics, several phones.
- Front end: raw audio, Apple voice processing, DeepFilterNet.
- ASR: Apple SpeechTranscriber, WhisperKit, Parakeet (FluidAudio),
  sherpa-onnx, one or more cloud APIs.
- Diarization: SpeakerKit, FluidAudio (pyannote), sherpa-onnx, cloud API,
  each with and without speaker enrollment.
- Mode: streaming (live) or offline (second pass on the full recording).

Not every combination makes sense. Start with a short list of complete
pipelines, not the full matrix.

## Metrics

| Metric | Meaning |
|---|---|
| WER | Word error rate of the transcript |
| DER | Diarization error rate: missed speech, false speech and wrong speaker, as a share of total speech time |
| cpWER | Word error rate after the best match of hypothesis speakers to reference speakers. It scores text and labels together |
| Latency | Time from the end of a word until the app shows it |
| Real-time factor | Processing time divided by audio time |
| Power | Watts on the device, from Instruments or `powermetrics` |
| Cost | Money per audio hour, for cloud APIs |

cpWER is the main score, because it measures what a reader sees: the right
words on the right speaker.

## Test corpus

1. Record real sessions: a quiet room, a cafe, a pub. Use 2, 4 and 6 speakers.
2. Record each session on several mic setups at the same time.
3. Label 10 minutes of each session by hand: text, speaker and time. Use the
   best offline pipeline to make a draft, then correct it.
4. Store the audio and labels outside git (large files, and other people's
   voices). Get consent from every speaker before you record.
5. Add public sets for a baseline: AMI (meetings, close and far mics) and
   CHiME-6 (dinner parties).

## Architecture

- **iOS app (Swift, SwiftUI).** Records audio, runs the on-device pipelines in
  parallel or one after another, and shows the transcripts side by side.
- **Common output format.** Every pipeline writes the same JSON: segments with
  start, end, speaker and words. RTTM export for DER tools.
- **Scoring tool.** Compares each output with the reference and writes a table
  of metrics. Use existing scorers (`pyannote.metrics`, `meeteval` for cpWER)
  where possible.
- **Server runner (optional).** Runs the Python and cloud pipelines on the same
  recordings, for the offline comparison.

## First milestones

1. Swift app that records and shows one live pipeline (FluidAudio).
2. Add a second on-device pipeline (WhisperKit + SpeakerKit) and a side-by-side
   view.
3. Common output format and a scoring tool.
4. Record and label the first test session.
5. Add speaker enrollment and the offline second pass.
6. Add cloud pipelines and the external mic array.

## Open questions

- Can the phone run two or three full pipelines live at the same time, or must
  the bench replay the recording through each one?
- Does iOS give any multi-channel access to the built-in mics?
- Does enrollment help in noise as much as we expect?
