// Set de íconos del prototipo (SVG inline, trazo con currentColor).
const ICONS: Record<string, { sw: number; body: string }> = {
  home: { sw: 2, body: "<path d=\"M3 11l9-8 9 8\"/><path d=\"M5 10v10h14V10\"/>" },
  calendar: { sw: 2, body: "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 10h18\"/>" },
  clock: { sw: 2, body: "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>" },
  chart: { sw: 2, body: "<path d=\"M4 20V10M12 20V4M20 20v-7\"/>" },
  user: { sw: 2, body: "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21c1.5-4 5-6 8-6s6.5 2 8 6\"/>" },
  users: { sw: 2, body: "<circle cx=\"9\" cy=\"8\" r=\"3.2\"/><path d=\"M2.5 20c1-3.2 3.6-5 6.5-5s5.5 1.8 6.5 5\"/><circle cx=\"17.5\" cy=\"8.5\" r=\"2.4\"/><path d=\"M15.5 12c2.3.3 4 1.8 4.8 4.4\"/>" },
  bolt: { sw: 2, body: "<path d=\"M13 2 4 14h6l-1 8 9-12h-6l1-8Z\"/>" },
  box: { sw: 2, body: "<path d=\"M21 8 12 3 3 8v8l9 5 9-5V8Z\"/><path d=\"m3 8 9 5 9-5M12 13v8\"/>" },
  tag: { sw: 2, body: "<path d=\"M20 10.5 12.5 18a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1 0-2.8L11.2 2H18a2 2 0 0 1 2 2v6.5Z\"/><circle cx=\"15\" cy=\"8\" r=\"1.3\"/>" },
  gear: { sw: 2, body: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z\"/>" },
  chevron: { sw: 2, body: "<path d=\"m9 18 6-6-6-6\"/>" },
  location: { sw: 2, body: "<path d=\"M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.3\"/>" },
  check: { sw: 2.4, body: "<path d=\"M20 6 9 17l-5-5\"/>" },
  x: { sw: 2, body: "<path d=\"M18 6 6 18M6 6l12 12\"/>" },
  plus: { sw: 2.4, body: "<path d=\"M12 5v14M5 12h14\"/>" },
  swap: { sw: 2, body: "<path d=\"M17 2l4 4-4 4M3 12v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 12v1a4 4 0 0 1-4 4H3\"/>" },
  bell: { sw: 2, body: "<path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9\"/><path d=\"M13.7 21a2 2 0 0 1-3.4 0\"/>" },
  gift: { sw: 2, body: "<rect x=\"3\" y=\"8\" width=\"18\" height=\"4\"/><path d=\"M12 8v13M19 8v13H5V8\"/><path d=\"M12 8c-1.5 0-3-1.2-3-2.7C9 4 10 3 11.3 3c1.7 0 3.7 2 3.7 5m0 0c1.5 0 3-1.2 3-2.7C18 4 17 3 15.7 3 14 3 12 5 12 8\"/>" },
  trend: { sw: 2, body: "<path d=\"M3 17l6-6 4 4 8-8\"/><path d=\"M15 7h6v6\"/>" },
  wallet: { sw: 2, body: "<rect x=\"2\" y=\"6\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M2 10h20\"/><circle cx=\"17\" cy=\"15\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>" },
  eye: { sw: 2, body: "<path d=\"M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>" },
  eyeOff: { sw: 2, body: "<path d=\"M17.9 17.9A10.4 10.4 0 0 1 12 20c-6.4 0-10-8-10-8a18.6 18.6 0 0 1 4.2-5.2M9.9 4.2A9.7 9.7 0 0 1 12 4c6.4 0 10 8 10 8a18.7 18.7 0 0 1-2.3 3.4M14.1 14.1a3 3 0 1 1-4.2-4.2\"/><path d=\"M2 2l20 20\"/>" },
  logout: { sw: 2, body: "<path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"/><path d=\"M16 17l5-5-5-5\"/><path d=\"M21 12H9\"/>" },
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const icon = ICONS[name];
  if (!icon) return null;
  return (
    <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={icon.sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: icon.body }}
      />
    </span>
  );
}
