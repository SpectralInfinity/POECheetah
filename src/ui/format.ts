import type { Mode } from "../core/goals";

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "+3.5%", "−1.2%", "0%" for a relative change (0.035 = +3.5%). */
export const signed = (x: number) => `${x >= 0.0005 ? "+" : x <= -0.0005 ? "−" : ""}${Math.abs(Math.round(x * 1000) / 10)}%`;

/** How the numbers were calculated, for the UI. */
export const MODE_TEXT: Record<Mode, string> = {
  configured: "with your Path of Building config as set",
  conservative: "without your situational assumptions (enemy ignited, buffs up…)",
  boss: "against an uber pinnacle boss, without situational assumptions",
};
