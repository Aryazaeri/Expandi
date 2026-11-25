import { LiraMark } from "@/components/lira-mark";
import { ImageResponse } from "next/og";

const SIZES = new Set([180, 192, 512]);

/** App icons for the PWA manifest / iOS home screen, drawn on the fly. */
export async function GET(_req: Request, ctx: RouteContext<"/icons/[size]">) {
  const { size: raw } = await ctx.params;
  const size = SIZES.has(Number(raw)) ? Number(raw) : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #059669 0%, #065f46 100%)",
          color: "white",
          fontSize: size * 0.55,
          fontWeight: 700,
          letterSpacing: -size * 0.02,
        }}
      >
        <LiraMark size={size * 0.6} />
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=604800, immutable" } },
  );
}
