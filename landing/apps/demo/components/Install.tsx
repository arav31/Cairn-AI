'use client';
import { useState } from 'react';

const CMD: Record<string, string> = {
  menu: 'node src/cli.js',
  list: 'node src/cli.js list',
  check: 'node src/cli.js check-url "https://example.com"',
  record: 'node src/cli.js record "https://example.com/form" --name example-form',
};

export default function Install() {
  const [pm, setPm] = useState<keyof typeof CMD>('menu');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(CMD[pm]!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div>
      <div className="pm-tabs">
        {Object.keys(CMD).map((k) => (
          <button key={k} className={pm === k ? 'active' : ''} onClick={() => setPm(k as keyof typeof CMD)}>
            {k}
          </button>
        ))}
      </div>
      <div className="code-block" style={{ padding: '18px 20px', fontSize: 14 }}>
        <button className="copy" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
        <span className="token-punct">$ </span>
        <span>{CMD[pm]}</span>
      </div>
    </div>
  );
}
