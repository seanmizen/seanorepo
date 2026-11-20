# Sample data

The comparison bench needs real recordings with known speakers. This guide
tells how to record them with the iOS app.

## Consent

Get consent from every speaker before you record. The app does not start until
you set "All speakers agree to this recording". Tell people that the audio is
for testing speech software and that it stays private.

## What to record

Start with this set. Each session is 10-20 minutes.

| Session | Room | Speakers | Mic |
|---|---|---|---|
| 1 | Quiet room at home | 2 | Phone on the table |
| 2 | Quiet room at home | 4 | Phone on the table |
| 3 | Cafe | 3-4 | Phone on the table |
| 4 | Pub | 4-6 | Phone on the table |
| 5 | Pub | 4-6 | Phone in a shirt pocket |

When you have a second phone, record sessions 3 and 4 on both phones at the
same time. One recording, two mic positions, gives a direct comparison.

## How to record

1. Open the **Record** tab.
2. Set the room, the number of speakers, the mic setup and the placement. The
   placement is free text, for example "on the table, 1 m from most people".
3. Write notes: music, a TV, a loud table near you, who sits where.
4. Set the consent switch.
5. Tap the record button. Put the phone down. Do not touch it during the
   session, because the mic records every touch.
6. Tap stop. Wait for "Saving" to go away.

Say the names of the speakers at the start (for example, "Sean, Ana, Tom"). It
is free and it helps later, when you label the text by hand.

## What the app saves

Each session is a folder in `Documents/sessions/<date-time>/`:

| File | Content |
|---|---|
| `audio.wav` | Raw audio, 16-bit PCM, at the native rate and channel count of the input. Apple voice processing is off |
| `session.json` | Your form data, plus the device model, iOS version, input port, sample rate and duration |
| `live.json` | The transcript from pipeline 1, in the common output format. Missing if the models were not loaded |

The size of the audio is about 5.5 MB per minute at 48 kHz mono.

## How to get the files off the phone

- **Files app:** open **On My iPhone**, then **lessdeaf**, then **sessions**.
  Copy the folders to iCloud Drive, or use AirDrop.
- **Share button:** on the **Sessions** tab, tap the share button on a session.
  This sends its files.
- **Mac:** connect the iPhone, open it in Finder, then select **Files** and
  **lessdeaf**. Drag the `sessions` folder out.

## Where to keep the data

Do not commit the recordings to git. They are large, and they hold the voices
of other people. Keep them in a private folder outside the repo. The scoring
tool will read them from a path that you give it.

## Next: the reference transcript

To score a pipeline, each session needs a reference: the correct words, the
correct speaker and the time of each part. Make it from about 10 minutes of
each session:

1. Run the best offline pipeline on the audio to make a draft.
2. Correct the draft by hand: the words, the speaker names and the turn
   times.

The tools for this step are a later milestone.
