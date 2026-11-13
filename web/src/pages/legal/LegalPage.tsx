import React from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../../components/Logo';

const UPDATED = '13 November 2026';

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
        title: 'What Sahayak does',
        body: (
          <p>
            Sahayak matches a vehicle owner&rsquo;s request with a verified partner (a mechanic, tow operator or fuel
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
    ]}
  />
);

export const PrivacyPage: React.FC = () => (
  <Shell
    title="Privacy"
    intro="This page explains what Sahayak collects, why, and who can see it."
    sections={[
      {
        title: 'What we collect',
        body: (
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Your mobile number, to sign you in with a one-time code.</li>
            <li>Your name, and an email address if you choose to add one.</li>
            <li>Your vehicles: type, make, model, year and registration number.</li>
            <li>For each request: the pickup location you set, the service, any notes, its status history and any rating or comment.</li>
            <li>For partners: your services, your verification status, and your location while you are on duty.</li>
          </ul>
        ),
      },
      {
        title: 'Why we collect it',
        body: (
          <p>
            To match a request with a nearby partner, to show you what is happening, to keep a record of what happened
            on each request, and to keep the service safe and accurate. We do not sell your information.
          </p>
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
              run and support the service.
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
        title: 'Your choices',
        body: (
          <p>
            You can turn location access off in your device settings (you can still set a pin by hand), and partners can
            go off duty at any time. To ask about your information, speak to the Sahayak team.
          </p>
        ),
      },
    ]}
  />
);
