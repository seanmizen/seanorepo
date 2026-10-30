# Concept

## The problem

In a loud room, people with hearing loss lose the conversation. Background
noise, distance and people who talk at the same time all make speech hard to
follow. A live transcript helps, but only if it shows **who** said each line.
A transcript with no speaker labels is a wall of text.

The task has two parts:

1. **Transcription (ASR).** Convert speech to text.
2. **Diarization.** Split the audio by speaker: who spoke when.

## The product

A phone app. It listens through a mic and shows a live transcript. Each speaker
has a color and, after enrollment, a name.

## The comparison idea

Many models and services can do each part. Their results change a lot with the
room, the mic and the number of speakers. Benchmarks on clean audio do not
predict results in a pub.

So lessdeaf starts as a **comparison bench**:

- Record one session.
- Run it through several pipelines at the same time, or one after another on
  the recording.
- Show the transcripts side by side.
- Score each pipeline against a hand-checked reference.
- Report accuracy, latency, power and cost for each one.

The bench is also the product prototype. The pipeline that wins in real rooms
becomes the default live mode.

## Difficulty, by scenario

| Scenario | Difficulty | Expected result |
|---|---|---|
| 2-4 people, quiet room, phone on the table | Solved | Good transcript and speaker labels |
| Busy cafe, 3-5 people, phone at 1 m | Medium | Text is mostly correct. Labels swap at times. Short interjections get lost |
| Loud bar or party, people talk at the same time, phone in a pocket | Research problem (the "cocktail party problem") | Many errors. Overlapping speech is the weak point for every system |

The main limit is physics, not compute. One distant mic records a mix. When
the speech-to-noise ratio is low, the information is not in the signal. A
closer or better mic gives more improvement than a bigger model.

## Ideas to test

1. **Speaker enrollment.** Each person reads a few seconds of speech once. The
   app stores a voice embedding and puts real names on the labels. Matching a
   known voice is easier than clustering unknown voices, so enrollment may also
   improve accuracy in noise.
2. **Two passes.** Show a fast live draft. After the session, run a second pass
   over the full recording. Offline clustering sees all the audio, so it is
   usually more accurate than streaming.
3. **Noise reduction on or off.** Denoising can make ASR worse, because it
   removes cues that the model uses. Test both.
4. **Mic setups.** Phone mic, external USB-C mic array, lapel mics, or several
   linked phones (each phone near its owner).
