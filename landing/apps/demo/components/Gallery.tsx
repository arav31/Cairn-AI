'use client';
import { DitheredWaves, type DitherMode } from '@cairn/wavefield';

interface Preset {
  label: string;
  mode: DitherMode;
  paletteId: string;
  resolution: number;
  matrixSize?: 2 | 4 | 8;
  wave: string;
  base: string;
  pixelSize: number;
  colorNum: number;
  waveFrequency: number;
  waveAmplitude: number;
  waveSpeed: number;
}

const PRESETS: Preset[] = [
  { label: 'Capture',     mode: 'bayer',  paletteId: 'capture', resolution: 320, matrixSize: 8,
    wave: '#133f22', base: '#efe1c6', pixelSize: 3, colorNum: 8,
    waveFrequency: 3.1, waveAmplitude: 0.32, waveSpeed: 0.035 },

  { label: 'Compiler',    mode: 'ascii',  paletteId: 'compiler', resolution: 220,
    wave: '#0c4850', base: '#efe1c6', pixelSize: 3, colorNum: 8,
    waveFrequency: 3.6, waveAmplitude: 0.38, waveSpeed: 0.05 },

  { label: 'Verifier',    mode: 'dots',   paletteId: 'verifier', resolution: 260,
    wave: '#7d4a10', base: '#edd9b8', pixelSize: 4, colorNum: 8,
    waveFrequency: 3.2, waveAmplitude: 0.34, waveSpeed: 0.04 },

  { label: 'Policy',      mode: 'bayer',  paletteId: 'policy',   resolution: 280, matrixSize: 4,
    wave: '#123f39', base: '#eadbc1', pixelSize: 3, colorNum: 8,
    waveFrequency: 2.9, waveAmplitude: 0.3, waveSpeed: 0.045 },

  { label: 'Repair',      mode: 'floyd',  paletteId: 'repair',   resolution: 260, matrixSize: 8,
    wave: '#782418', base: '#ecd5bd', pixelSize: 3, colorNum: 8,
    waveFrequency: 2.6, waveAmplitude: 0.4, waveSpeed: 0.05 },

  { label: 'Audit',       mode: 'dots',   paletteId: 'audit',    resolution: 220,
    wave: '#4f461d', base: '#e9d8b4', pixelSize: 4, colorNum: 8,
    waveFrequency: 3.4, waveAmplitude: 0.32, waveSpeed: 0.04 },
];

function PresetCard({ p, onApply }: { p: Preset; onApply: (p: Preset) => void }) {
  return (
    <div className="gallery-card" onClick={() => onApply(p)}>
      <DitheredWaves
        mode={p.mode}
        waveColor={p.wave}
        baseColor={p.base}
        pixelSize={p.pixelSize}
        colorNum={p.colorNum}
        waveFrequency={p.waveFrequency}
        waveAmplitude={p.waveAmplitude}
        waveSpeed={p.waveSpeed}
        enableMouseInteraction={false}
        style={{ width: '100%', height: '100%' }}
      />
      <div className="gallery-card-meta">
        <span>{p.label}</span>
        <span style={{ color: 'var(--accent)' }}>{p.mode} · {p.colorNum}lv</span>
      </div>
    </div>
  );
}

export default function Gallery({ onApply }: { onApply: (p: Preset) => void }) {
  return (
    <div className="gallery">
      {PRESETS.map((p) => <PresetCard key={p.label} p={p} onApply={onApply} />)}
    </div>
  );
}

export type { Preset };
