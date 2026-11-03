import { Box } from '../ui/Box';

/**
 * The privacy notice of the crm, at `/privacy` (`routes/privacy.tsx`).
 *
 * This file holds all of the text, as plain JSX, so a change to the notice
 * is an ordinary PR, and git keeps each version. The sections are in the
 * order of the ICO privacy notice template. Each section is one `Box`.
 *
 * When the text changes, change PRIVACY_UPDATED to the date of the change.
 * The page shows it as "Last updated".
 */

/** The date of the last change to the text, as `YYYY-MM-DD`. */
export const PRIVACY_UPDATED = '2026-11-03';

/** The contact for each privacy request. */
export const PRIVACY_EMAIL = 'sean@seanmizen.com';

/** The ICO registration number. A placeholder until Sean registers. */
export const ICO_REGISTRATION = '[ICO registration number pending]';

const Email = () => <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;

/** The sections of the notice, in order. */
export const PrivacyNotice = () => (
  <>
    <Box title="Who I am">
      <p>
        This notice tells you what personal data I keep, why I keep it, and your
        rights. I sell software services to businesses, and I sell some of them
        door to door.
      </p>
      <dl>
        <dt>Data controller</dt>
        <dd>Sean Mizen, sole trader</dd>
        <dt>Email</dt>
        <dd>
          <Email />
        </dd>
        <dt>ICO registration</dt>
        <dd>{ICO_REGISTRATION}</dd>
      </dl>
    </Box>

    <Box title="The data I keep">
      <ul>
        <li>
          <strong>Prospects</strong>: the people and businesses that I visit or
          contact. I keep your name, your business name and address, your phone
          number and email address, and my visit notes.
        </li>
        <li>
          <strong>Clients</strong>: the same data, and also your contract and
          your billing records (invoices, payments, and the billing name and
          address). Stripe keeps your card or bank details. I do not see your
          card number.
        </li>
        <li>
          <strong>Sign-in</strong>: if you sign in to this site, I keep your
          email address and your passkeys (if you add one). I also keep a record
          of each session: the name of the browser, when you signed in, and when
          you last used the site.
        </li>
      </ul>
      <p>
        Most of this data comes from you: at your door, by phone or by email. I
        write the visit notes. I can also use public information about a
        business, for example its website.
      </p>
    </Box>

    <Box title="Why I keep it">
      <ul>
        <li>
          <strong>Prospects: legitimate interests.</strong> I have a legitimate
          interest to offer my services to local businesses, and to remember who
          I visited and what they said. You can object at any time. If you
          object, I stop. I keep only your address and a "do not knock" record,
          so that I do not visit you again.
        </li>
        <li>
          <strong>Clients: contract.</strong> I need your data to make our
          contract, to do the work, and to bill you.
        </li>
        <li>
          <strong>Tax and accounting records: legal obligation.</strong> The law
          tells me to keep these records for HMRC.
        </li>
        <li>
          <strong>Sign-in: legitimate interests.</strong> I keep the sign-in
          records to keep your account safe.
        </li>
      </ul>
      <p>
        I do not sell your data. I do not make automated decisions about you.
      </p>
    </Box>

    <Box title="Who receives it">
      <p>
        The database is on a server that I control, in the UK. These companies
        process some of the data for me:
      </p>
      <ul>
        <li>
          <strong>Stripe</strong>: takes payments, and keeps the billing records
          of clients.
        </li>
        <li>
          <strong>Cloudflare</strong>: carries the traffic to this site, and
          keeps the backups of the database. The backups are in the EU.
        </li>
        <li>
          <strong>Google</strong>: sends the emails from this site, for example
          the sign-in email (Gmail).
        </li>
        <li>
          <strong>Anthropic</strong>: only if I use the Claude assistant with
          this site. Anthropic then processes the data that the assistant reads.
        </li>
      </ul>
      <p>
        I also give records to my accountant, or to HMRC, when the law tells me
        to.
      </p>
    </Box>

    <Box title="Transfers outside the UK">
      <ul>
        <li>
          <strong>The EU</strong>: the backups are in the EU. UK law allows this
          transfer under the UK adequacy regulations for the EU.
        </li>
        <li>
          <strong>The US</strong>: Stripe, Cloudflare, Google and Anthropic are
          US companies, and can process data in the US. Their transfer terms
          protect UK data, for example the UK-US data bridge or the UK
          International Data Transfer Addendum.
        </li>
      </ul>
    </Box>

    <Box title="How long I keep it">
      <ul>
        <li>
          <strong>Relationship data</strong> (contacts, visit notes and phone
          numbers): I delete it when you ask. For a prospect, I also delete it
          after about 12 months with no activity.
        </li>
        <li>
          <strong>Statutory records</strong> (contracts, invoices, payments, and
          the billing name and address): I keep them for 7 years after the last
          transaction. Tax law and contract law need them. Then I delete them.
          If you ask me to delete them before that, I keep them only for the
          law, and I use them for nothing else.
        </li>
        <li>
          <strong>"Do not knock" records</strong>: only the address. I keep it
          so that I do not knock again.
        </li>
        <li>
          <strong>Sign-in sessions</strong>: a session ends when you sign out,
          or after 90 days.
        </li>
        <li>
          <strong>Backups</strong>: each backup lasts 90 days. After that, the
          data that I deleted is gone from the backups too.
        </li>
      </ul>
    </Box>

    <Box title="Your rights">
      <p>You have the right to:</p>
      <ul>
        <li>get a copy of your data, with my notes about you (access)</li>
        <li>correct data that is wrong (correction)</li>
        <li>tell me to delete your data (erasure)</li>
        <li>tell me to stop using your data, but keep it (restriction)</li>
        <li>
          object when I use your data for legitimate interests (objection)
        </li>
        <li>
          get your data in a file that you can give to another company
          (portability)
        </li>
      </ul>
      <p>
        To ask, email <Email />. You do not usually pay a fee. I reply within
        one month.
      </p>
    </Box>

    <Box title="Complaints">
      <p>
        If you are not happy with how I use your data, email me first. You can
        also complain to the Information Commissioner's Office (ICO):{' '}
        <a href="https://ico.org.uk/make-a-complaint/">
          ico.org.uk/make-a-complaint
        </a>
        , or phone 0303 123 1113.
      </p>
    </Box>

    <Box title="Cookies">
      <p>
        This site has one cookie, <code>crm_session</code>. It keeps you signed
        in, for up to 90 days. It is strictly necessary, so it needs no consent.
        A visitor who does not sign in gets no cookie. This site has no
        tracking, analytics or advertising cookies. Thank god.
      </p>
    </Box>

    <Box title="Changes">
      <p>When I change this notice, I change the date at the top.</p>
    </Box>
  </>
);
