'use client';
import { DitheredWaves, type DitherMode } from '@cairn/wavefield';
import CodeShowcase from '../components/CodeShowcase';

// Where the "Open app" CTA points. Swap to your own host if it moves.
const APP_URL = 'https://cairn-ai-gamma.vercel.app';
const GITHUB_URL = 'https://github.com/arav31/Cairn-AI';
// Set to a real YouTube id when the walkthrough is ready; empty = graceful placeholder.
const VIDEO_ID = '';

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

const STEPS = [
  { name: 'Record', body: 'An authorized user does the task once. Cairn watches the real, multi-request flow underneath the clicks.' },
  { name: 'Compile', body: 'That flow becomes a typed API — defined inputs and outputs, not a screen recording.' },
  { name: 'Verify', body: 'Every API runs end to end before it goes live. If it does not pass, it does not ship.' },
  { name: 'Reuse', body: 'Call it forever over HTTP, OpenAPI, MCP, or the SDK/CLI. One recording, every agent.' },
  { name: 'Repair', body: 'Cairn keeps watching. When the site changes, it re-verifies and repairs so your agents do not break.' },
];

export default function Page() {
  return (
    <main className="noise crt">
      {/* ---------- hero ---------- */}
      <section className="hero clean-hero" id="top">
        <header className="topbar">
          <a className="brand" href="#top">cairn</a>
          <div className="topbar-right">
            <nav aria-label="Primary">
              <a href="#how">How it works</a>
              <a href="#what">What you get</a>
              <a href="#demo">Demo</a>
            </nav>
            <a className="button" href={APP_URL} target="_blank" rel="noreferrer">Open app</a>
          </div>
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
          <p className="prompt">your private workflow APIs</p>
          <h1>Record once.<br /><em>Reuse forever.</em><span className="cursor" /></h1>
          <p>
            Cairn turns a browser task you already do by hand into a durable, private API — typed,
            verified, and yours. You and your agents call it forever, and Cairn keeps it working when
            the site changes.
          </p>
          <div className="hero-actions">
            <a className="button primary" href={APP_URL} target="_blank" rel="noreferrer">Open app</a>
            <a className="button" href="#demo">Watch the demo</a>
          </div>
          <div className="metric-strip">
            <span><strong>Typed</strong> — OpenAPI + MCP</span>
            <span><strong>Durable</strong> — auto-verified &amp; repaired</span>
            <span><strong>Private</strong> — only your agents</span>
          </div>
        </div>
      </section>

      {/* ---------- the problem ---------- */}
      <section className="pad" id="problem" data-anchor="the problem">
        <div className="container">
          <h2>Your best workflows are <em>trapped in a browser.</em></h2>
          <p className="lede">
            The useful work — logging in, filling the form, reading the result — lives behind clicks no
            API exposes. So your agents re-drive the browser every single time: slow, brittle, and
            repeated on every run. Cairn captures that flow once and gives you the API the site never did.
          </p>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="pad" id="how" data-anchor="how it works">
        <div className="container">
          <h2>From a recording to an API <em>your agents own.</em></h2>
          <p className="lede">Five steps, once. After that, it is just an endpoint.</p>
          <ol className="beat-list">
            {STEPS.map((step) => (
              <li key={step.name}>
                <span><strong>{step.name}</strong> — {step.body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- what you get ---------- */}
      <section className="pad" id="what" data-anchor="what you get">
        <div className="container">
          <div className="split">
            <div>
              <h2>One recording. <em>Every way your agents call.</em></h2>
              <p className="lede">
                Each API ships as a typed endpoint with an OpenAPI spec, an MCP tool, and SDK/CLI access —
                all secured by your agent key. Same input, same contract, whichever surface your agent
                reaches for.
              </p>
            </div>
            <CodeShowcase />
          </div>
        </div>
      </section>

      {/* ---------- durability ---------- */}
      <section className="pad" id="durability" data-anchor="durability">
        <div className="container">
          <div className="split">
            <div>
              <h2>It keeps working when <em>the site changes.</em></h2>
              <p className="lede">
                A recorded script breaks the day the site moves a button. A Cairn API re-verifies on a
                schedule and repairs itself on drift — so the contract your agents depend on stays stable.
              </p>
              <div className="status-row">
                <span className="status-pill is-active">Active</span>
                <span className="status-pill is-verifying">Verifying</span>
                <span className="status-pill is-repair">Needs repair</span>
              </div>
            </div>
            <div className="skill-card">
              <div className="skill-name">supplier-status</div>
              <div className="skill-route">POST /api/tools/supplier-status/invoke</div>
              <div className="status-grid" style={{ marginTop: 18 }}>
                <span>status</span><strong>active</strong>
                <span>last verified</span><strong>2h ago</strong>
                <span>total calls</span><strong>1,284</strong>
                <span>uptime · 30d</span><strong>100%</strong>
              </div>
              <div className="mini-log">
                <div>site changed a selector · drift detected</div>
                <div>re-synthesized request flow · repaired</div>
                <div>re-verified end to end · back to active</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- private by design ---------- */}
      <section className="pad" id="private" data-anchor="private by design">
        <div className="container">
          <div className="security-strip">
            <div>
              <h2>Your APIs. Your agents. <em>Nobody else.</em></h2>
              <p className="lede">
                Every API is scoped to your account and team. There is no public catalog, no marketplace,
                and nothing shared you did not ask for. You own the contract; each agent calls it with its
                own key. Authorized by design.
              </p>
            </div>
            <div className="security-list">
              <span>Scoped to your account &amp; team</span>
              <span>No public catalog or marketplace</span>
              <span>Per-agent keys you can rotate</span>
              <span>You own the contract end to end</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- demo video (secondary) ---------- */}
      <section className="video-section" id="demo">
        <div className="video-layout">
          <div className="video-copy">
            <h2>Watch a workflow <em>become an API.</em></h2>
            <p className="lede">
              Record a real browser task, watch Cairn compile and verify it, then call the API from an
              agent.{VIDEO_ID ? '' : ' The full walkthrough lands here soon.'}
            </p>
          </div>
          <div className="video-shell">
            {VIDEO_ID ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1`}
                title="Cairn demo video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <div className="video-placeholder">
                <span className="prompt">demo coming soon</span>
                <p>record → compile → verify → reuse</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- final cta ---------- */}
      <section className="cta-band">
        <div className="container">
          <h2>Record once. <em>Reuse forever.</em></h2>
          <p>
            Turn your next browser task into an API your agents keep forever — typed, private, and
            repaired when the web moves.
          </p>
          <div className="hero-actions">
            <a className="button primary" href={APP_URL} target="_blank" rel="noreferrer">Open app</a>
            <a className="button" href="#how">See how it works</a>
          </div>
          <div className="cli-line">
            or start from your terminal — <code>npx cairn record &lt;url&gt;</code>
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer>
        <div className="container">
          <span className="footer-brand">cairn — record once, reuse forever.</span>
          <div className="footer-links">
            <a href={APP_URL} target="_blank" rel="noreferrer">App</a>
            <a href="#how">How it works</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
