# Monetisation

Two paths, ranked by friction (lowest first).

---

## Path 1: Advertising

### Ranked Options

#### 1. Carbon Ads ⭐ RECOMMENDED for dev audience
- Single, tasteful ad per page — one image + one line of text
- Specifically for developer/design audiences — ads are for SaaS tools, dev products
- CPM: ~$2–4 (low volume) but high quality; no janky popups
- Zero user friction: one small card in the corner, never intrusive
- Apply at: carbonads.com — you need ~10k monthly visitors to be accepted

**Implementation**: One `<script>` tag, one `<div>`. Takes 10 minutes.
```html
<script
  async
  type="text/javascript"
  src="//cdn.carbonads.com/carbon.js?serve=YOUR_CODE&placement=yoursite"
  id="_carbonads_js"
></script>
```

#### 2. EthicalAds
- Privacy-respecting, no tracking, GDPR-compliant by design
- Run by Read the Docs — trusted by dev community
- CPM: ~$1.50–3
- Good fit if you want to position the tool as privacy-first
- Apply at: ethicalads.io

#### 3. Google AdSense
- Easiest to get started, auto-fills ads
- But: ugly, distracting, privacy-invasive, and pays $0.10–0.50 CPM for utility tools
- Users hate it; conversion tools don't have high AdSense RPM
- Use only as a fallback if Carbon/Ethical reject you

#### 4. Affiliate Links
- Link to DaVinci Resolve, HandBrake, FFmpeg documentation, or a relevant video editor
- "Need more control? Try [HandBrake](https://handbrake.fr) — free desktop app"
- Amazon Associates or direct affiliate programs if you link to paid tools
- No application required, zero user friction — just a text link
- Low earnings but 0% rejection risk

### Ad Placement Strategy

```
┌──────────────────────────────────────┐
│  Drop zone (main action)             │
│                                      │
│  [Carbon Ad — small, top right]      │
│                                      │
│  Format picker                       │
│                                      │
│  [Affiliate text link — subtle]      │
└──────────────────────────────────────┘
```

Put ads below the fold or in the sidebar — never between the drop zone and the convert button. Users who are interrupted mid-flow never return.

---

## Path 2: Usage Tokens via Stripe

### Architecture Sketch

**Model**: Anonymous users get 5 free conversions/day (by IP + fingerprint). Paid users buy a token pack — tokens never expire.

**Why token packs, not subscriptions**: Lower friction, lower chargeback risk, no monthly cancellation anxiety for users. A £5 top-up is an impulse purchase; a £5/month subscription requires justification.

### Token Packs

| Pack | Tokens | Price | Per conversion |
|------|--------|-------|----------------|
| Starter | 20 | £2 | 10p |
| Standard | 100 | £8 | 8p |
| Power | 500 | £30 | 6p |

### Database Schema (SQLite)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,         -- uuid
  created_at INTEGER NOT NULL,
  email TEXT,                  -- optional, for receipt
  tokens INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT
);

CREATE TABLE token_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,      -- positive = purchase, negative = usage
  reason TEXT NOT NULL,        -- "purchase:pack_100" | "conversion:job_xxx"
  created_at INTEGER NOT NULL
);

CREATE TABLE free_usage (
  ip_hash TEXT NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, date)
);
```

### API Flow (pseudocode)

```
// 1. Before starting a conversion job:
function canConvert(req):
  userId = getCookieUserId(req)  // persistent anon ID in cookie
  
  if userId has tokens > 0:
    deductToken(userId)
    return allow
  
  ipHash = sha256(req.remoteAddr)
  today = date.today()
  freeCount = db.query("SELECT count FROM free_usage WHERE ip_hash=? AND date=?", ipHash, today)
  
  if freeCount < 5:
    db.exec("INSERT OR REPLACE INTO free_usage VALUES (?, ?, ?)", ipHash, today, freeCount+1)
    return allow
  
  return deny("Free limit reached. Buy tokens to continue.")

// 2. Stripe Checkout session creation:
POST /api/checkout
body: { pack: "pack_100" }

stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [{ price: PRICE_ID_FOR_PACK_100, quantity: 1 }],
  success_url: "https://seansconverter.com/success?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://seansconverter.com",
  metadata: { userId: req.cookieUserId, pack: "pack_100" },
})

// 3. Stripe webhook handler:
POST /api/stripe/webhook
headers: { Stripe-Signature: ... }

event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)

if event.type == "checkout.session.completed":
  session = event.data.object
  userId = session.metadata.userId
  pack = session.metadata.pack
  tokens = PACK_TOKENS[pack]  // e.g. 100
  
  db.exec("UPDATE users SET tokens = tokens + ? WHERE id = ?", tokens, userId)
  db.exec("INSERT INTO token_ledger VALUES (?, ?, ?, 'purchase:'+pack, ?)", 
          newUUID(), userId, tokens, now())
  
  log("Credited " + tokens + " tokens to " + userId)
```

### Refunds / Chargebacks

- Stripe Dashboard → Refunds are manual; refund the Stripe charge and subtract the credited tokens from ledger
- Chargebacks: set `stripe.radar.rules` to block cards with >1 dispute in Stripe Radar
- For a personal tool, you'll see near-zero fraud — just add a "no refunds after tokens are used" policy in the ToS

### Implementation Checklist

- [ ] Add `stripe` Go package: `go get github.com/stripe/stripe-go/v76`
- [ ] Add SQLite schema migration (use `golang-migrate` or manual `CREATE TABLE IF NOT EXISTS`)
- [ ] Implement `/api/checkout` endpoint (creates Stripe session, returns URL)
- [ ] Implement `/api/stripe/webhook` (handles `checkout.session.completed`)
- [ ] Implement `canConvert()` middleware before job creation
- [ ] Set persistent cookie on first visit (SameSite=Lax, 1-year expiry, httpOnly)
- [ ] Add "Buy tokens" button in frontend when limit is hit
- [ ] Add token balance display in header (fetch from `/api/me`)

### Stripe Checkout — what it looks like

```
User clicks "Buy 100 tokens (£8)"
  → POST /api/checkout
  → Redirect to stripe.com/pay/cs_xxx
  → User pays with card
  → Stripe sends webhook to /api/stripe/webhook
  → Tokens credited silently
  → User lands on /success page showing new balance
```

The whole flow takes 5 minutes for the user. No account creation, no email verification — just a payment and tokens appear.

---

## Recommendation

Start with **Carbon Ads + affiliate links** (1 hour to implement, zero friction). Once you have 5k monthly users, add **token packs** — the conversion rate from free limit → paid is typically 1–3% for utility tools, meaning at 10k conversions/day you'd see ~50–150 token purchases/month.
