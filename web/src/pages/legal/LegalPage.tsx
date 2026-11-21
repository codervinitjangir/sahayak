import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';

const UPDATED = '21 November 2026';

/**
 * Consumer Protection (E-Commerce) Rules, 2020, rule 4: the platform must show the
 * grievance officer's name, designation and contact details. The name is a person
 * the company appoints (R1 in docs/REMAINING-WORK.md): replace it before launch.
 */
/**
 * Itemised notice (DPDP Act 2023, Rules 2025 rule 3): each item of personal data
 * with its purpose. Keep in step with the code; retention values come from
 * ADR-025, ADR-038, ADR-042 and ADR-045.
 */
export const PRIVACY_ITEMS: { item: string; why: string; kept: string }[] = [
  { item: 'Mobile number', why: 'Sign-in with a one-time code; so the assigned partner or owner can call you', kept: 'Until you delete your account' },
  { item: 'Name, and email if you add one', why: 'Shown to the other side of an accepted job; receipts', kept: 'Until you delete your account' },
  { item: 'Vehicles (type, make, model, registration number)', why: 'Telling the partner what to expect', kept: 'Until you delete the vehicle or your account' },
  { item: 'Pickup location, service, notes, booked time, status history', why: 'Matching a nearby partner and showing progress', kept: 'With the job record; your notes and address are erased when you delete your account' },
  { item: 'Partner live location', why: 'Matching and tracking while on duty; during an accepted job also while you use another app for directions, with a notification showing whenever this is on; checking the start code is entered at the vehicle', kept: 'Only the latest position, never a history; removed when you delete your account' },
  { item: 'Partner documents (licence, photo ID, tow papers)', why: 'Verifying who is offered jobs', kept: 'While you are a partner; deleted 90 days after a rejection, and when you delete your account' },
  { item: 'Tow photos (pickup and drop)', why: 'Settling damage disputes', kept: 'With the job record' },
  { item: 'Ratings and problem reports', why: 'Quality, matching and resolving complaints', kept: 'With the job record; your written comments are erased when you delete your account' },
  { item: 'Sahayak Care membership (plan, dates, call-outs used)', why: 'Knowing which jobs your plan covers', kept: 'Until you delete your account' },
  { item: 'Device push token', why: 'Sending job alerts to your phone', kept: 'Until you sign out or delete your account' },
  { item: 'Error reports from the app', why: 'Finding and fixing crashes', kept: 'In server logs, which are rotated by our hosting provider' },
];

export const GRIEVANCE_OFFICER = {
  name: 'Grievance Officer',
  designation: 'Sahayak',
  email: 'support@sahayak.app',
  phone: '+91 92505 43490',
  tel: 'tel:+919250543490',
};

interface Section {
  title: string;
  body: React.ReactNode;
}

const Shell: React.FC<{ title: string; intro: string; sections: Section[] }> = ({ title, intro, sections }) => (
  <div className="min-h-screen bg-white text-ink">
    <header className="border-b border-line">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" aria-label="Sahayak home">
          <Logo />
        </Link>
        <nav aria-label="Legal" className="flex gap-5 text-sm font-medium text-ink-soft">
          <Link to="/terms" className="hover:text-ink">Terms</Link>
          <Link to="/privacy" className="hover:text-ink">Privacy</Link>
          <Link to="/delete-account" className="hover:text-ink">Delete account</Link>
        </nav>
      </div>
    </header>
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-ink-muted">Last updated {UPDATED}</p>
      <p className="mt-5 text-lg text-ink-soft leading-relaxed">{intro}</p>
      {sections.map((s) => (
        <section key={s.title} className="mt-8">
          <h2 className="text-xl font-semibold">{s.title}</h2>
          <div className="mt-2 text-ink-soft leading-relaxed space-y-3">{s.body}</div>
        </section>
      ))}
    </main>
  </div>
);

export const TermsPage: React.FC = () => (
  <Shell
    title="Terms of Service"
    intro="Sahayak helps people who have broken down find a nearby roadside partner. These terms explain how that works. By using Sahayak you agree to them."
    sections={[
      {
        title: 'In an emergency, call 112 first',
        body: (
          <p>
            Sahayak is not an emergency service. If anyone is in danger, call <a className="font-semibold text-emergency-700 underline" href="tel:112">112</a> before
            anything else.
          </p>
        ),
      },
      {
        title: 'Who can use Sahayak',
        body: (
          <p>
            You must be 18 or older to use Sahayak, as an owner or as a partner. We do not knowingly collect information
            about children.
          </p>
        ),
      },
      {
        title: 'What Sahayak does',
        body: (
          <p>
            Sahayak matches a vehicle owner&rsquo;s request with a verified partner (a mechanic or tow operator
            provider) and shows the progress of the request. Partners are independent service providers. They are not
            employees of Sahayak, and the repair, towing or delivery is carried out by them.
          </p>
        ),
      },
      {
        title: 'Matching is not a guarantee',
        body: (
          <p>
            We offer each request to the partners we judge to be the best fit, but we cannot promise that a partner will
            be available or how quickly they will arrive. If no partner accepts, the request ends and you can try again.
          </p>
        ),
      },
      {
        title: 'Prices',
        body: (
          <p>
            Sahayak does not set or quote prices. The final price is confirmed when the job is completed, between the
            owner and the partner, and the partner records it in the app.
          </p>
        ),
      },
      {
        title: 'Your account and what you tell us',
        body: (
          <p>
            Sign-in is with a code sent to your mobile number. Keep your number and codes to yourself. Give accurate
            details about your vehicle, your location and what went wrong, and do not make requests you do not intend to
            use. Partners must keep their services and equipment details accurate and may only receive jobs once the
            Sahayak team has verified their account.
          </p>
        ),
      },
      {
        title: 'Start code',
        body: (
          <p>
            Each assigned request has a four-digit start code shown to the owner. Share it with the partner only once
            they have reached your vehicle. Work cannot start without it.
          </p>
        ),
      },
      {
        title: 'Ratings',
        body: (
          <p>
            After a completed job the owner can rate the partner. Ratings and acceptance history are used when matching
            future requests.
          </p>
        ),
      },
      {
        title: 'Suspending accounts',
        body: (
          <p>
            We may suspend or remove an account that is used to mislead others, harass anyone or misuse the service.
          </p>
        ),
      },
      {
        title: 'Complaints and grievance officer',
        body: (
          <>
            <p>
              If something went wrong with a job, use <strong>Report a problem</strong> on that job in the app. You can also
              write to our grievance officer:
            </p>
            <p>
              {GRIEVANCE_OFFICER.name}, {GRIEVANCE_OFFICER.designation}
              <br />
              <a className="font-semibold text-[#111111] underline" href={`mailto:${GRIEVANCE_OFFICER.email}`}>
                {GRIEVANCE_OFFICER.email}
              </a>
              {' '}· <a className="font-semibold text-[#111111] underline" href={GRIEVANCE_OFFICER.tel}>{GRIEVANCE_OFFICER.phone}</a>
            </p>
            <p>
              We acknowledge every complaint within 48 hours and resolve it within one month of receiving it, as the
              Consumer Protection (E-Commerce) Rules, 2020 require. If you are not satisfied, you can approach the National
              Consumer Helpline (1915) or your district consumer commission.
            </p>
          </>
        ),
      },
      {
        title: 'Support and contact',
        body: (
          <p>
            If you need support with an active request, have questions about these terms, or need billing assistance,
            reach the Sahayak team at{' '}
            <a className="font-semibold text-[#111111] underline" href="mailto:support@sahayak.app">
              support@sahayak.app
            </a>{' '}
            or call <a className="font-semibold text-[#111111] underline" href="tel:+919250543490">+91 92505 43490</a>.
            Our operations team is available 24/7 for active roadside assistance.
          </p>
        ),
      },
    ]}
  />
);

export const PrivacyPage: React.FC = () => (
  <Shell
    title="Privacy"
    intro="This page explains what Sahayak collects, why, and who can see it."
    sections={[
      {
        title: 'What we collect, why, and for how long',
        body: (
          <>
            <p>
              Each item below is collected only for the purpose next to it. Nothing is sold, and nothing is used for
              advertising.
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-ink">
                    <th scope="col" className="py-2 pr-3 border-b border-line">Information</th>
                    <th scope="col" className="py-2 pr-3 border-b border-line">Why</th>
                    <th scope="col" className="py-2 border-b border-line">How long</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {PRIVACY_ITEMS.map((row) => (
                    <tr key={row.item}>
                      <td className="py-2 pr-3 border-b border-line font-medium text-ink">{row.item}</td>
                      <td className="py-2 pr-3 border-b border-line">{row.why}</td>
                      <td className="py-2 border-b border-line">{row.kept}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ),
      },
      {
        title: 'Who can see what',
        body: (
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Partners offered your request</strong> see the service, your vehicle and the pickup address. They
              do not see your name or phone number.
            </li>
            <li>
              <strong>The partner assigned to your request</strong> then sees your name and phone number so they can reach
              you. You see their name, rating and phone number at the same point.
            </li>
            <li>
              <strong>Sahayak&rsquo;s operations team</strong> can see requests, accounts and verification status in order to
              run and support the service. Partner documents and tow photos are opened only by named staff roles, and every
              view is recorded.
            </li>
          </ul>
        ),
      },
      {
        title: 'Location',
        body: (
          <p>
            Owners share a location only for the request they are making, either from their device&rsquo;s GPS or a pin
            they place. Partners share their location only while they are on duty, and stop sharing when they go off
            duty. The &ldquo;Share location&rdquo; button sends a map link through your own device&rsquo;s share sheet;
            it does not send anything to Sahayak.
          </p>
        ),
      },
      {
        title: 'Your rights',
        body: (
          <>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>See your information:</strong> download everything we hold about you from Settings, Download my data.</li>
              <li><strong>Correct it:</strong> edit your name and email in the app; for anything else, write to us.</li>
              <li>
                <strong>Withdraw consent and delete it:</strong> delete your account yourself at any time; see{' '}
                <Link className="font-semibold text-[#111111] underline" to="/delete-account">how to delete your account</Link>.
              </li>
              <li><strong>Choose what to share:</strong> turn location off in your device settings (you can still set a pin by hand); partners can go off duty at any time.</li>
              <li><strong>Nominate someone</strong> to act for you if you cannot: write to us.</li>
            </ul>
            <p>
              For any privacy question or complaint, write to{' '}
              <a className="font-semibold text-[#111111] underline" href={`mailto:${GRIEVANCE_OFFICER.email}`}>{GRIEVANCE_OFFICER.email}</a>.
              If you are not satisfied with our answer, you can complain to the Data Protection Board of India.
            </p>
          </>
        ),
      },
    ]}
  />
);

/**
 * Public account-deletion page (ADR-045). Google Play asks for a web link that
 * explains how to delete an account without reinstalling the app.
 */
export const AccountDeletionPage: React.FC = () => (
  <Shell
    title="Delete your Sahayak account"
    intro="You can delete your account yourself, in the app or on the web, at any time. Nobody has to approve it."
    sections={[
      {
        title: 'If you are a vehicle owner',
        body: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>In the Sahayak app: Profile, then Settings, then <strong>Delete account</strong>.</li>
            <li>
              On the web: <Link className="font-semibold text-[#111111] underline" to="/login">sign in</Link>, open your account,
              and choose <strong>Delete account</strong>.
            </li>
          </ol>
        ),
      },
      {
        title: 'If you are a partner',
        body: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>In the Sahayak app: Account, then Settings, then <strong>Delete partner account</strong>.</li>
            <li>On the web: sign in to the partner console, open Settings, and choose <strong>Delete partner account</strong>.</li>
          </ol>
        ),
      },
      {
        title: 'What is deleted',
        body: (
          <p>
            Your name, phone number, email, vehicles, notifications and your sign-in. For partners also your services,
            equipment, uploaded documents and job alerts, and anything you wrote in ratings. If the same number has both an
            owner and a partner profile, deleting one keeps the other.
          </p>
        ),
      },
      {
        title: 'What is kept, and why',
        body: (
          <p>
            Past jobs, their payments and rating scores stay, without your name or number, because the person on the
            other side of each job keeps their own history and payment records point at them. Photos taken during a tow
            stay with the job so a problem report about it can still be settled. You cannot delete while a request or job
            is in progress: finish or cancel it first.
          </p>
        ),
      },
      {
        title: 'Cannot sign in?',
        body: (
          <p>
            Email{' '}
            <a className="font-semibold text-[#111111] underline" href={`mailto:${GRIEVANCE_OFFICER.email}?subject=Delete%20my%20account`}>
              {GRIEVANCE_OFFICER.email}
            </a>{' '}
            with the phone number on the account. We confirm the number is yours before deleting.
          </p>
        ),
      },
    ]}
  />
);
