'use client';
import { DitheredWaves, type DitherMode } from '@cairn/wavefield';
import Install from '../components/Install';

const DEFAULT_SIGNAL = {
  mode: 'bayer' as DitherMode,
  matrixSize: 8 as 2 | 4 | 8,
  wave: '#5f7f32',
  base: '#eee3ce',
  pixelSize: 4,
  colorNum: 4,
  waveFrequency: 3.15,
  waveAmplitude: 0.34,
  waveSpeed: 0.035,
};

const nav = [
  ['Platform', '#platform'],
  ['Marketplace', '#marketplace'],
  ['Security', '#security'],
  ['Launch', '#launch'],
];

const platform = [
  ['Record', 'An authorized operator completes the task once in a real browser while Cairn captures actions, page state, and backend traffic.'],
  ['Synthesize', 'The trace becomes a dependency graph, typed schemas, fresh-token extractors, selection rules, and one callable operation.'],
  ['Verify', 'Every operation is replayed against a known input and published only after the final output matches the captured success state.'],
  ['Heal', 'Scheduled checks detect drift, derive a repair proposal from a fresh authorized run, and version the fixed operation after verification.'],
  ['Govern', 'Skills carry owners, scopes, allowed domains, input constraints, rate limits, risk tiers, approvals, and rollback versions.'],
  ['Audit', 'Every invocation records caller, version, policy decision, input hash, output hash, timing, and outcome.'],
];

const demoBeats = [
  'Turns a search, row selection, and detail view into one typed operation.',
  'Derives record IDs from live responses instead of hard-coding clicked rows.',
  'Refreshes CSRF and ViewState at runtime so legacy replay actually works.',
  'Verifies the operation against a new input before agents can call it.',
  'Detects drift, proposes a repaired version, and publishes only after re-verification.',
  'Blocks unapproved actions through scoped skill policy before anything reaches the target.',
];

const marketplace = [
  ['Private catalog', 'Company-owned skills with owners, descriptions, scopes, versions, verification freshness, and usage logs.'],
  ['Approval workflow', 'Compliance reviewers can approve, revoke, inspect, and export every skill and invocation.'],
  ['Future listings', 'Paid partner skills, usage metering, quotas, and agent purchase controls can layer on later.'],
];

export default function Page() {
  return (
    <main className="noise crt">
      <section className="hero clean-hero">
        <header className="topbar">
          <a className="brand" href="#">cairn</a>
          <nav aria-label="Primary">
            {nav.map(([label, href]) => (
              <a key={label} href={href}>{label}</a>
            ))}
          </nav>
        </header>

        <div className="hero-bg">
          <DitheredWaves
            mode={DEFAULT_SIGNAL.mode}
            matrixSize={DEFAULT_SIGNAL.matrixSize}
            waveColor={DEFAULT_SIGNAL.wave}
            baseColor={DEFAULT_SIGNAL.base}
            waveSpeed={DEFAULT_SIGNAL.waveSpeed}
            waveFrequency={DEFAULT_SIGNAL.waveFrequency}
            waveAmplitude={DEFAULT_SIGNAL.waveAmplitude}
            pixelSize={DEFAULT_SIGNAL.pixelSize}
            colorNum={DEFAULT_SIGNAL.colorNum}
            enableMouseInteraction
            mouseRadius={0.25}
          />
        </div>

        <div className="hero-heading hero-copy reveal">
          <h1><em>Cairn</em><span className="cursor" /></h1>
          <p>
            Cairn watches an authorized user complete a task once, compiles the hidden multi-request backend flow, verifies it end to end, and exposes it as a permissioned skill agents can safely call.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#launch">Launch prototype</a>
            <a className="button ghost" href="#platform">See platform</a>
          </div>
          <div className="hero-note">
            Record once. Run directly. Repair when targets change.
          </div>
        </div>
      </section>

      <section className="video-section" id="demo-video" data-anchor="demo video">
        <div className="video-layout">
          <div className="video-copy">
            <h2>watch the <em>demo</em>.</h2>
            <p className="lede">
              This section is reserved for the recorded walkthrough. Replace the placeholder embed with the final YouTube link when the demo video is ready.
            </p>
          </div>
          <div className="video-shell">
            <iframe
              src="https://www.youtube-nocookie.com/embed/VIDEO_ID?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1"
              title="Cairn demo video placeholder"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      <section className="pad" id="platform" data-anchor="platform">
        <div className="container">
          <h2>what <em>cairn</em> does.</h2>
          <p className="lede">
            Browser agents click through fragile UIs on every run. Cairn turns the demonstrated workflow into a stable typed interface with verification, repair, permissions, and audit built in.
          </p>
          <div className="feature-grid">
            {platform.map(([title, body]) => (
              <article className="feature-card" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pad" id="demo" data-anchor="proof">
        <div className="container demo-layout">
          <div>
            <h2>proof it is <em>not a script</em>.</h2>
            <p className="lede">
              The hard case is a legacy portal with server-rendered pages, hidden state, stale tokens, and row-dependent navigation. Cairn proves the workflow by replaying the backend chain with a new input, repairing drift, and enforcing policy before an agent ever touches it.
            </p>
          </div>
          <ol className="beat-list">
            {demoBeats.map((beat) => (
              <li key={beat}>{beat}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pad" id="marketplace" data-anchor="marketplace">
        <div className="container">
          <h2>skills need a <em>home</em>.</h2>
          <p className="lede">
            Cairn starts as a company-private marketplace for verified automation APIs. Teams publish approved skills, agents request only what policy allows, and reviewers keep ownership visible.
          </p>
          <div className="market-grid">
            {marketplace.map(([title, body]) => (
              <article className="market-card" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pad" id="security" data-anchor="security">
        <div className="container security-strip">
          <div>
            <h2>authorized by <em>design</em>.</h2>
            <p className="lede">
              Cairn operates only on owned or authorized systems. Agents see typed skill calls, not cookies, raw headers, session state, proxy traces, passwords, or credentials.
            </p>
          </div>
          <div className="security-list">
            <span>encrypted session artifacts</span>
            <span>domain allowlists</span>
            <span>revocable approvals</span>
            <span>human review for risky repairs</span>
          </div>
        </div>
      </section>

      <section className="pad" id="launch" data-anchor="launch">
        <div className="container split">
          <div>
            <h2>run the <em>prototype</em>.</h2>
            <p className="lede">
              The local CLI opens the Cairn menu, checks target URLs, records authorized workflows, and lists saved skills.
            </p>
          </div>
          <Install />
        </div>
      </section>

      <footer>
        <div className="container">
          <div>Cairn — verified APIs from authorized browser workflows</div>
          <div className="footer-links">
            <a href="#platform">Platform</a>
            <a href="#marketplace">Marketplace</a>
            <a href="#security">Security</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
