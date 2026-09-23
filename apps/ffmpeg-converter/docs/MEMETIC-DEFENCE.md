# Memetic defence: honest premium framing

Read this before you name, word or price a feature as "premium". It
protects the visitor from us, and it protects us from ourselves.

## The five lines

Learn these. Each one blocks a known failure.

1. **Who saves, who pays?** Write down who gains and who loses. Count
   money, time, effort and risk. If we gain and the user pays, the
   feature is not premium.
2. **Numbers before names.** Measure the feature first. Write the
   numbers down, and only then choose the name.
3. **Name the benefit, not the badge.** The name says what the user gets
   ("Private", "Offline"). Status words ("Premium", "Pro", "Elite") need
   a measured benefit behind them.
4. **Show the catch where they choose.** The downside is on the button or
   next to it. It is not in an FAQ, a tooltip or a footnote.
5. **Never make the default worse.** We do not slow or reduce the free
   path to make the other path look better.

## Why we need a defence

### Cheaper for the maker, sold as premium

Car makers replaced buttons and dials with touchscreens, and sold the
screens as modern and premium. The CEO of Ferrari said that touch
controls cost half as much as physical buttons
([The Drive](https://www.thedrive.com/news/touch-controls-are-50-cheaper-than-real-buttons-ferrari-ceo-says)).
In a test by the Swedish magazine Vi Bilägare, drivers needed 10 seconds
for four tasks in an old Volvo with buttons, and 30.4 seconds in a BMW iX
with a touchscreen
([Auto123](https://www.auto123.com/en/news/touchscreens-buttons-study-distraction-driving/69529/)).
From 2026, Euro NCAP takes points from cars without physical controls for
essential functions ([ETSC](https://etsc.eu/cars-will-need-buttons-not-just-touchscreens-to-get-a-5-star-euro-ncap-safety-rating/)).

The pattern: the maker saved money, the user paid in time and risk, and
the words said "premium". Line 1 catches this.

### A cost cut with a better story

Apple stopped putting a charger in the iPhone box in 2020, and gave an
environmental reason. Courts and regulators in Brazil did not accept the
reason, and fined Apple
([AppleInsider](https://appleinsider.com/articles/21/03/20/brazil-fines-apple-19m-for-not-including-charger-in-iphone-12-box)).
The São Paulo court said that under a "green initiative" the company
made the customer buy a charger that the box used to include. A true
benefit (less waste) did not make the story honest, because the story
hid who paid.

### The user does our work

Craig Lambert calls it "shadow work": self-checkout, self-service and
self-booking move unpaid work from the company to the customer
([Harvard Magazine](https://www.harvardmagazine.com/2015/05/craig-lambert-book-shadow-work)).
People also value a thing more when they made it themselves: the IKEA
effect (Norton, Mochon and Ariely, 2012,
[Journal of Consumer Psychology](https://www.sciencedirect.com/science/article/abs/pii/S1057740811000829)).
So "your machine does the work" can feel good to the user and still be
shadow work. Line 1 catches this.

### A worse version on purpose

Economists call a product that the seller makes worse on purpose, to
sell the better one at a higher price, a "damaged good" (Deneckere and
McAfee, 1996,
[Journal of Economics & Management Strategy](https://onlinelibrary.wiley.com/doi/10.1111/j.1430-9134.1996.00149.x)).
It can be fair when the cheap version is real value. It is not fair when
we make the free path slower only to sell the fast one. Line 5 blocks
this.

### Why good people believe their own pitch

This is the part that needs a defence and not only a rule.

- **We believe what we get paid to say.** In two experiments (688
  people), people who could earn money by persuading others became more
  confident in their own result. The higher confidence then made them
  more persuasive (Schwardmann and van der Weele, 2019,
  [Nature Human Behaviour](https://www.nature.com/articles/s41562-019-0666-7)).
  The belief comes after the incentive, and it feels sincere. Line 2
  puts the facts on paper before the incentive can change them.
- **We avoid the fact that would stop us.** When people could stay
  ignorant of the harm to others with one click, many chose not to look,
  and then acted more selfishly (Dana, Weber and Kuang, 2007,
  [Economic Theory](https://link.springer.com/article/10.1007/s00199-006-0153-z)).
  Line 4 takes that "moral wiggle room" away: the catch is on the page,
  so we see it every time we see the button.

The defence is a set of short lines because a rule must be quick to
recall at the moment that you write the copy. At that moment the
incentive is strongest.

## The check before launch

Do these steps for every feature that has the word premium, a special
color, a badge, or a price.

1. Fill in the table below with measured numbers.
2. Answer the five lines in writing, in the PR.
3. Give the table and the copy to a reviewer who has no part in the
   sales goal. A separate agent with no revenue goal counts. The reviewer
   answers one question: "Is any sentence untrue, or true but chosen to
   hide who pays?"
4. Apply the reversal test: "Would we still offer this if it cost us
   more?" If the answer is no, the reason for the feature is our cost,
   and the copy must not say otherwise.

| Question                         | Server path | The feature |
| -------------------------------- | ----------- | ----------- |
| Time for a 50 MB phone video     |             |             |
| Time on a mid-range phone        |             |             |
| Largest file that works          |             |             |
| Where the file goes              |             |             |
| Battery and heat on the device   |             |             |
| Cost to us for each conversion   |             |             |

UK consumer law also applies. Under the Digital Markets, Competition and
Consumers Act 2024, the CMA can fine a business up to 10% of worldwide
turnover for misleading actions and omissions, without a court
([Fox Williams](https://www.foxwilliams.com/2024/09/26/the-digital-markets-competition-and-consumers-act-2024-explained/)).

## Applied: local conversion (ffmpeg WASM)

### Who saves, who pays

- **The user gains:** the file never leaves the device. There is no
  upload, which saves time for a large file on a slow connection.
- **The user pays:** ffmpeg in WASM is much slower than native ffmpeg.
  One report gives about 40 frames per second for 720p in the browser
  against about 500 on native ffmpeg on the same hardware
  ([RenderIO](https://renderio.dev/blogs/ffmpeg-wasm-guide)). WASM memory
  stops at 2 GB, and the practical limit is lower on phones. The browser
  first downloads the ffmpeg core. The device uses battery and gets warm.
- **We gain:** no server CPU and no bandwidth for that conversion.

Result: the feature is not better in general. It is better for privacy,
and often for small files. It is worse for large files and on phones. It
fails line 1 as "premium". It passes as "private".

### Recommendation

- **Name:** "Convert on this device".
- **Words next to the button:** "Private: your file never leaves your
  device. Slower on phones and for large files."
- **Special color:** yes. It is a real choice with a real benefit, and it
  is fine to make it feel good. The flattery ("your device can do this")
  is true, so it passes. It must sit next to the catch (line 4).
- **Price:** free. It costs us less, so a price fails line 1 and the
  reversal test. Charge for what costs us more to deliver: larger files,
  a faster queue, batches and the API.
- **Default:** the page recommends the path that finishes first for this
  file on this device. It does not push the user to the path that is
  cheaper for us.
- **Before launch:** fill in the table with numbers from the WASM spike.
  If the numbers change the facts above, change the words.
