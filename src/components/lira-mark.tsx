/** ₺ drawn as SVG so OG/icon rendering doesn't need a font that has the glyph. */
export function LiraMark({ size, color = "white" }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M42 16 V82 C62 82 78 68 79 48" />
      <path d="M26 50 L64 34" />
      <path d="M26 66 L64 50" />
    </svg>
  );
}
