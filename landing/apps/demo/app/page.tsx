'use client';
import { DitheredWaves, type DitherMode } from '@cairn/wavefield';

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

export default function Page() {
  return (
    <main className="noise crt">
      <section className="hero clean-hero">
        <header className="topbar">
          <a className="brand" href="#">cairn</a>
          <nav aria-label="Primary">
            <a href="#demo-video">Demo</a>
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
            <a className="button primary" href="#demo-video">Watch demo</a>
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
    </main>
  );
}
