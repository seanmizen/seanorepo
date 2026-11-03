# 001: Guiding design

`apps/crm` is a homebrew CRM for one solo developer who sells software
services door to door. Most clients are on monthly rolling contracts. Some
clients also get ad-hoc charges.

This document sets the direction for the app. Later tickets build the
features. Each feature gets requirement IDs when a ticket builds it.

## Summary

A homebrew CRM is reasonable for a solo developer, because the scope is
narrow. Stripe can do all the payment, invoice, recurring and one-off billing
work. Do not build invoicing in the CRM.

The CRM keeps the relationship data. Stripe keeps the money data.

The two hard parts are:

1. The split between GDPR erasure and statutory retention.
2. The doorstep sign-up flow.

## Main features

1. **Contacts and organisations.** People, businesses, addresses and
   geo-coordinates. Each record shows its lawful basis and the source of the
   data.
2. **Territory view.** A map of streets and visits, with a status for each
   address: not visited, no answer, call back, do not knock. A standard CRM
   does this badly for door-to-door work.
3. **Pipeline.** Stages such as lead → visited → follow-up → quoted →
   won/lost. Every open deal has a next action and a date.
4. **Activity log.** Visits, calls, emails, notes and photos. On a phone, the
   user must be able to log a visit in about 10 seconds.
5. **Tasks and reminders.** A "today" list, made from the next-action dates.
6. **Service catalogue.** Monthly plans and one-off items. The CRM mirrors
   them to Stripe Products and Prices.
7. **Quotes and contracts.** A quote goes to the client as a link, and the
   client accepts it. The CRM records the T&Cs version that the client
   accepted, and the time of acceptance.
8. **Billing view.** A read-only mirror of Stripe subscriptions, invoices,
   payments and failed payments. Stripe webhooks keep it current.
9. **Reports.** MRR, churn, aged debt, and conversion by area or street.
10. **GDPR tools.** Data export for subject access requests (DSARs), erasure,
    a retention schedule with automatic purge, a suppression list, and an
    audit log.
11. **Auth.** The app has one user, so it uses a passkey. Cloudflare Access
    sits in front of the app.

## GDPR and record-keeping

### Two tiers of data

The duty to erase and the duty to keep records do not conflict. Under UK
GDPR, the right to erasure has exemptions:

- [Art. 17(3)(b)][gdpr-17]: compliance with a legal obligation.
- [Art. 17(3)(e)][gdpr-17]: the establishment, exercise or defence of legal
  claims.

So the CRM puts its data into two tiers:

| Tier | Contents | On an erasure request |
|---|---|---|
| Relationship | Prospects, notes, visit logs, phone numbers, photos | Delete it immediately |
| Statutory | Invoices, payments, contracts, billing name and address, VAT data | Restrict processing, set a purge date, and delete on that date |

### Retention rules

- **Retention period.** HMRC wants records for
  [5 years after the 31 January filing deadline][hmrc-sole] for a sole trader.
  It wants [6 years for a limited company][hmrc-ltd] and
  [6 years for VAT records][hmrc-vat]. The
  [Limitation Act 1980][limitation] gives 6 years for contract claims. In
  practice, keep statutory records for 7 years after the last transaction.
  Then purge them automatically.
- **Prospects that never sign.** Use legitimate interests as the lawful
  basis. Write a short legitimate interests assessment (LIA). Purge a
  prospect automatically after about 12 months with no activity.
- **"Do not knock" requests.** The law permits a minimal suppression record
  (the address only), so that the CRM respects the objection.
- **Free-text notes.** The client can see them through a DSAR. Write them
  with that in mind.
- **Erasure and backups.** The ICO accepts erased data in backups if the data
  is "beyond use" and the backups expire. Keep an erasure log of record IDs.
  Apply the log again after every restore.
- **ICO data protection fee.** The [fee][ico-fee] is almost certainly
  necessary (tier 1, about £52 a year).
- **Other countries.** A design to UK GDPR also covers most of the EU rules
  and most of CCPA.

### The main legal risk: doorstep consumer sales

The main legal risk comes from consumer law, not from GDPR. A sale to a
*consumer* at their door is an off-premises contract under the
[Consumer Contracts Regulations 2013][ccr-2013]. These rules apply:

1. The client gets 14 days to cancel.
2. The seller must give the cancellation information in writing.
3. If the seller does not give that information, the seller commits a
   criminal offence. The cancellation period also extends to 12 months.
4. If the work starts within the 14 days, the client must ask for that
   explicitly.

The sign-up flow must do all of this. B2B sales are exempt.

## Stripe

### Scope

Stripe does all of the billing work:

- **Monthly rolling contracts.** Stripe Billing subscriptions. The Customer
  Portal lets clients change their card and cancel.
- **Ad-hoc charges.** Add invoice items to the next subscription invoice (one
  bill each month). Or send a one-off invoice with a hosted payment page.
- **Bacs Direct Debit.** The default for UK monthly clients. It costs less on
  larger amounts, and it does not fail when a card expires.
- **Stripe Tax.** Use it only after VAT registration (the threshold is £90k).
- **Stripe is not the accounting system.** Making Tax Digital for Income Tax
  starts in April 2026 for income over £50k, and in April 2027 for income over
  £30k. Export to FreeAgent or Xero.

### Fees

These UK fees are **approximate**. Stripe changes its prices. Check the live
[Stripe UK pricing page][stripe-gb-pricing] before you rely on a number.

| Item | Fee (approximate) |
|---|---|
| UK standard cards | 1.5% + 20p (premium cards ~1.9% + 20p) |
| EEA / international cards | ~2.5% + 20p / ~3.25% + 20p, plus 2% for currency conversion |
| Bacs Direct Debit | ~1% + 20p, capped at £4 |
| Billing (subscriptions) | 0.7% of billing volume |
| Invoicing (one-off invoices) | 0.4% per paid invoice |
| Disputes | ~£20 for each card dispute |
| Monthly fee | None |

Example: £100/month by Bacs costs about £1.20 + £0.70 = £1.90 (1.9%). By
card, it costs about £1.70 + £0.70 = £2.40. On £5k MRR, the fees are about
£100–£120 a month.

### Doorstep sign-up

Tap to Pay on iPhone and Bluetooth readers need a native app with the
[Stripe Terminal SDK][stripe-tap]. A PWA cannot use them. So the doorstep
flow is:

1. The CRM shows a QR code, or texts a Stripe Checkout link to the client.
2. The client signs the Bacs mandate on their own phone.
3. The client accepts the T&Cs (Checkout terms-of-service consent).

This flow needs no hardware and no app store.

Never store card data. Checkout keeps the PCI scope at SAQ A.

## SQLite and backups

- The database is SQLite in [WAL mode][sqlite-wal].
- **Primary backup.** [Litestream][litestream] streams the database
  continuously to Cloudflare R2 or Backblaze B2. This gives point-in-time
  restore, and recovery if the box is lost.
- **OneDrive.** Litestream cannot write to OneDrive. A nightly job makes a
  [`VACUUM INTO`][sqlite-vacuum] snapshot, encrypts it with [`age`][age], and
  copies it with [`rclone`][rclone-onedrive]. Encrypt it, because it is
  personal data on a consumer cloud.
- **Never put the live `.db` file in a synced folder.** The OneDrive client
  will corrupt it.
- **Use a fixed backup retention** (for example 90 days), so that erased
  data expires from the backups.
- **A scripted restore test runs every month.**
- Litestream and the nightly snapshot run as sidecar containers in the same
  compose file as the app.

## Desktop and mobile parity

The app is one responsive, mobile-first frontend. The user installs it as a
PWA. It has a small offline capture queue for visits, notes and new leads.
Payments always happen online, on the client's phone.

## Offline sync

### IndexedDB

[IndexedDB][mdn-indexeddb] is a database in every browser. Each origin gets
its own private store of structured objects in object stores, with indexes
and transactions. The data persists across a tab close, a reboot and offline
periods. Use the [`idb`][idb] wrapper.

### Outbox design

1. Every offline change goes into a local `outbox` store, with a UUID that
   the client makes.
2. A sync loop sends the outbox to `POST /api/sync`. The server applies each
   item idempotently by UUID, so a retry cannot make duplicates.
3. When the server confirms an item, the client deletes it from the outbox.

**Offline work is append-only:** create a visit, a note, a new lead or a
photo. This removes merge conflicts. Edits to existing records, and all
actions that touch money, are online-only.

### iOS constraints

- Safari [deletes the storage of a site][webkit-7day] after 7 days with no
  visit. Home-screen PWAs are exempt. Install the CRM to the home screen, and
  call `navigator.storage.persist()`.
- iOS has no Background Sync API. Sync runs only while the app is open:
  - when the app opens
  - on return to the foreground (`visibilitychange`)
  - on the `online` event
  - on a retry timer

  Data from a session that closed offline stays safe in IndexedDB until the
  next open.
- `navigator.onLine` is not reliable. The app counts itself online only when
  a server request succeeds.

### Sync indicators

The browser shows no sync status, so the app must show it:

- **Header badge, always visible.** A green tick when synced. An amber
  "3 waiting" with a cloud-off icon when items wait. A tap opens the sync
  screen.
- **Sync screen.** Pending items, the time of the last successful sync,
  failed items with the server error, and a "sync now" button.
- **Pending dot.** Each unsynced record shows a "pending" dot in every list.
- **Home-screen icon badge.** Use [`navigator.setAppBadge(n)`][mdn-badge]
  (iOS 16.4+, home-screen apps only, needs notification permission).
- **Guard against data loss.** Block sign-out, and warn before the user
  clears site data, while the outbox has items.

### GDPR on the device

The phone holds only the outbox and the data for the current route. It never
holds a full copy. The client deletes synced items from the device.

## Sources

From the initial write-up:

- https://stripe.com/pricing
- https://stripe.com/pricing/local-payment-methods
- https://support.stripe.com/questions/june-2024-pricing-updates-for-bacs-direct-debit?locale=en-GB
- https://docs.stripe.com/payments/payment-methods/bacs-debit?locale=en-GB
- https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay
- https://litestream.io

Linked in this document:

- [Stripe UK pricing (live)][stripe-gb-pricing]
- [UK GDPR, Article 17][gdpr-17]
- [Consumer Contracts Regulations 2013][ccr-2013]
- [Limitation Act 1980, section 5][limitation]
- [HMRC: records for the self-employed][hmrc-sole]
- [HMRC: limited company records][hmrc-ltd]
- [HMRC: VAT record keeping][hmrc-vat]
- [ICO: data protection fee][ico-fee]
- [SQLite: WAL mode][sqlite-wal]
- [SQLite: `VACUUM INTO`][sqlite-vacuum]
- [age][age]
- [rclone: OneDrive][rclone-onedrive]
- [MDN: IndexedDB][mdn-indexeddb]
- [`idb`][idb]
- [WebKit: 7-day cap on script-writable storage][webkit-7day]
- [MDN: `navigator.setAppBadge()`][mdn-badge]

[stripe-gb-pricing]: https://stripe.com/gb/pricing
[stripe-tap]: https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay
[litestream]: https://litestream.io
[gdpr-17]: https://www.legislation.gov.uk/eur/2016/679/article/17
[ccr-2013]: https://www.legislation.gov.uk/uksi/2013/3134/contents
[limitation]: https://www.legislation.gov.uk/ukpga/1980/58/section/5
[hmrc-sole]: https://www.gov.uk/self-employed-records/how-long-to-keep-your-records
[hmrc-ltd]: https://www.gov.uk/running-a-limited-company/company-and-accounting-records
[hmrc-vat]: https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021
[ico-fee]: https://ico.org.uk/for-organisations/data-protection-fee/
[sqlite-wal]: https://www.sqlite.org/wal.html
[sqlite-vacuum]: https://www.sqlite.org/lang_vacuum.html#vacuuminto
[age]: https://github.com/FiloSottile/age
[rclone-onedrive]: https://rclone.org/onedrive/
[mdn-indexeddb]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
[idb]: https://github.com/jakearchibald/idb
[webkit-7day]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[mdn-badge]: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge
