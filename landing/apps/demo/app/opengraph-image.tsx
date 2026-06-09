import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Cairn — browser workflows into agent-ready APIs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background:
            'radial-gradient(ellipse at 30% 30%, rgba(79,127,42,0.16), transparent 55%), #efe5d1',
          color: '#182015',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ fontSize: 22, color: '#4f7f2a', letterSpacing: '0.08em', display: 'flex' }}>
          $ node src/cli.js
        </div>
        <div
          style={{
            fontSize: 180,
            fontWeight: 700,
            lineHeight: 0.95,
            marginTop: 32,
            letterSpacing: '-0.06em',
            display: 'flex',
            color: '#182015',
          }}
        >
          <span style={{ color: '#4f7f2a' }}>cairn</span>
        </div>
        <div style={{ fontSize: 28, marginTop: 36, color: '#68705f', display: 'flex' }}>
          record browser workflows once. run them as reusable agent skills.
        </div>
      </div>
    ),
    { ...size }
  );
}
