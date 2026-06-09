'use client';
import { useState } from 'react';
import type { DitherMode } from '@cairn/wavefield';

interface Props {
  mode: DitherMode;
  resolution: number;
  palette: string[];
  animate: boolean;
  matrixSize: number;
  paletteName: string;
  waveColor: string;
  baseColor: string;
  pixelSize: number;
  colorNum: number;
}

export default function Snippet({
  mode, resolution, palette, animate, matrixSize, paletteName,
  waveColor, baseColor, pixelSize, colorNum,
}: Props) {
  const [tab, setTab] = useState<'record' | 'invoke'>('record');
  const [copied, setCopied] = useState(false);

  const recordCode = `node src/cli.js record "https://example.com/form" \\
  --name supplier-status \\
  --goal "check status"`;

  const paletteStr = `[${palette.map((c) => `"${c}"`).join(', ')}]`;
  const invokeCode = `node src/cli.js run supplier-status \\
  --set accountId=demo-user \\
  --set mode=${mode} \\
  --set resolution=${resolution} \\
  --set palette='${paletteStr}' \\
  --set animate=${animate} \\
  --set matrixSize=${matrixSize}`;

  const code = tab === 'record' ? recordCode : invokeCode;

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlighted = esc(code)
    .replace(/\b(import|from)\b/g, '<span class="token-key">$1</span>')
    .replace(/(&lt;\/?[A-Z][A-Za-z]*|\/&gt;|&gt;)/g, '<span class="token-tag">$1</span>')
    .replace(/"([^"]+)"/g, '<span class="token-str">"$1"</span>')
    .replace(/(\{|\})/g, '<span class="token-punct">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');

  return (
    <div>
      <div className="pm-tabs" style={{ marginBottom: 12 }}>
        <button className={tab === 'record' ? 'active' : ''} onClick={() => setTab('record')}>record</button>
        <button className={tab === 'invoke' ? 'active' : ''} onClick={() => setTab('invoke')}>invoke</button>
      </div>
      <div className="code-block">
        <button className="copy" onClick={copy} aria-label="Copy snippet">
          {copied ? 'copied' : 'copy'}
        </button>
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        <div style={{ marginTop: 14, color: 'var(--fg-dim)', fontSize: 11 }}>
          current — <span style={{ color: 'var(--accent)' }}>{paletteName.toLowerCase()}</span>
          {tab === 'invoke' ? ` · ${mode}${mode === 'bayer' ? ` ${matrixSize}×${matrixSize}` : ''}` : ` · ${colorNum} levels · ${pixelSize}px`}
        </div>
      </div>
    </div>
  );
}
