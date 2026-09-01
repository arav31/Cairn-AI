import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://cairn.local'),
  title: 'Cairn — turn your browser workflows into durable, private APIs',
  description:
    'Record a browser workflow once and Cairn compiles it into a durable, private API — typed, verified, and yours. You and your agents call it forever, and Cairn repairs it when the site changes.',
  openGraph: {
    title: 'Cairn — record once, reuse forever.',
    description:
      'Durable, private APIs from recorded browser workflows. Typed (OpenAPI + MCP), verified end to end, and repaired when sites change.',
    type: 'website',
  },
};

const noscriptStyle = `
  body { background: #efe5d1; color: #182015; font-family: ui-monospace, monospace; }
  .noscript-fallback {
    min-height: 100svh; display: grid; place-items: center; padding: 32px; text-align: center;
  }
  .noscript-fallback h1 { color: #4f7f2a; font-size: 32px; margin: 0 0 12px; letter-spacing: -0.04em; }
  .noscript-fallback p { color: #68705f; max-width: 520px; line-height: 1.7; font-size: 13px; }
  .noscript-fallback a { color: #4f7f2a; }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <noscript>
          <style>{noscriptStyle}</style>
          <div className="noscript-fallback">
            <div>
              <h1>cairn</h1>
              <p>
                this demo needs JavaScript and WebGL2 to render the animated terminal background.
              </p>
            </div>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
