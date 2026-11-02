import { formatStat, type Stats } from "./stats";

/**
 * Build health check (design doc §3.7): warnings computed from Path of
 * Building's output. Uses PoB's maximum hit taken per damage type rather than
 * raw resistances, which mislead when damage is taken as another type.
 */

export type Severity = "warning" | "info";

export interface Finding {
  /** Stable id, used to tell which findings an item swap adds or removes. */
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

/** Tunable from real use. */
export const THRESHOLDS = {
  /** A damage type whose max hit is below this share of the best one is a weak spot. */
  weakSpotRatio: 0.6,
  /** An uncapped resist counts as covered when its max hit is at least this share of the best elemental one. */
  coveredRatio: 0.85,
  /** Attacks below this hit chance (%) get a warning. */
  minHitChance: 90,
  /** From this character level, life + energy shield below `minPool` gets a warning. */
  poolLevel: 80,
  minPool: 3500,
  /** Spell suppression at or above this (%) but below 100 counts as invested but uncapped. */
  suppressionInvested: 30,
};

const DAMAGE_TYPES = ["Physical", "Fire", "Cold", "Lightning", "Chaos"] as const;
const ELEMENTS = ["Fire", "Cold", "Lightning"] as const;
const ATTRIBUTES = [
  ["Str", "Strength"],
  ["Dex", "Dexterity"],
  ["Int", "Intelligence"],
] as const;

const num = (v: number) => formatStat("number", v);
const has = (s: Stats, key: string) => typeof s[key] === "number";

export function checkBuild(s: Stats, level: number): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, id: string, title: string, detail: string) =>
    findings.push({ id, severity, title, detail });

  // A minion skill with no minion to calculate (e.g. Raise Spectre with no spectre chosen).
  if (s.MinionMissing === 1) {
    add(
      "warning",
      "minion-missing",
      "No minion for Path of Building to calculate",
      "Your main skill raises minions, but none is chosen in Path of Building (for spectres: pick them in the Skills tab), so its damage shows as 0 and the advice can only rank defence. Choose the minion, then paste the code again.",
    );
  }

  // Weak spots by maximum hit taken.
  const maxHits = DAMAGE_TYPES.filter((t) => has(s, `${t}MaximumHitTaken`)).map((t) => ({
    type: t,
    value: s[`${t}MaximumHitTaken`],
  }));
  const best = maxHits.reduce((a, b) => (b.value > a.value ? b : a), maxHits[0]);
  for (const { type, value } of maxHits) {
    if (best && value < best.value * THRESHOLDS.weakSpotRatio) {
      const name = type.toLowerCase();
      const res = s[`${type}Resist`];
      const comparison = `The biggest ${name} hit you survive is ${num(value)}, against ${num(best.value)} for ${best.type.toLowerCase()}.`;
      if (res !== undefined && res >= 75) {
        // Resistance is already capped: still the weakest type, but not a resistance problem.
        add(
          "info",
          `weak-${type}`,
          `Weakest against ${name} hits`,
          `${comparison} Your ${name} resistance is already capped (${res}%), so more life or other ${name} mitigation is what would raise it.`,
        );
      } else {
        add("warning", `weak-${type}`, `Weak spot: ${name} hits`, comparison);
      }
    }
  }

  // Elemental resistances below cap, unless damage taken as another type covers them.
  const bestElemental = Math.max(0, ...ELEMENTS.map((e) => s[`${e}MaximumHitTaken`] ?? 0));
  for (const el of ELEMENTS) {
    const res = s[`${el}Resist`];
    if (res === undefined || res >= 75 || (s[`${el}ResistOverCap`] ?? 0) > 0) continue;
    const maxHit = s[`${el}MaximumHitTaken`];
    const name = el.toLowerCase();
    if (maxHit !== undefined && bestElemental > 0 && maxHit >= bestElemental * THRESHOLDS.coveredRatio) {
      add(
        "info",
        `res-${el}`,
        `${el} resistance ${res}%, but covered`,
        `Your max ${name} hit (${num(maxHit)}) is close to your best elemental max hit, so damage taken as another type covers it. Watch out if you change that gear.`,
      );
    } else {
      add(
        "warning",
        `res-${el}`,
        `${el} resistance ${res}% is below cap`,
        maxHit !== undefined
          ? `You take extra ${name} damage: your max ${name} hit is ${num(maxHit)}.`
          : `You take extra ${name} damage.`,
      );
    }
  }
  if ((s.ChaosResist ?? 0) < 0) {
    add("warning", "res-Chaos", `Chaos resistance ${s.ChaosResist}%`, "Negative chaos resistance makes chaos damage hit harder than normal.");
  }

  // Mana.
  const manaCost = s.ManaCost ?? 0;
  if (manaCost > 0 && has(s, "ManaUnreserved") && s.ManaUnreserved < manaCost) {
    add(
      "warning",
      "mana-cost",
      "Can't afford the main skill",
      `It costs ${num(manaCost)} mana but you have ${num(s.ManaUnreserved)} unreserved.`,
    );
  }
  const manaPerSecond = s.ManaPerSecondCost ?? 0;
  const regen = s.ManaRegenRecovery ?? 0;
  if (manaPerSecond > regen) {
    const onHit = (s.ManaLeechGainRate ?? 0) + (s.ManaOnHitRate ?? 0);
    if (manaPerSecond <= regen + onHit) {
      add(
        "info",
        "mana-sustain",
        "Mana relies on leech or mana on hit",
        `Using the skill costs ${num(manaPerSecond)} mana/s against ${num(regen)}/s regeneration. It's sustained while you hit, not while you can't (immune phases, missing).`,
      );
    } else {
      add(
        "warning",
        "mana-sustain",
        "Mana runs out",
        `Using the skill costs ${num(manaPerSecond)} mana/s; you recover about ${num(regen + onHit)}/s.`,
      );
    }
  }

  // Accuracy (attacks only; spells always hit).
  const hit = s.HitChance;
  if (hit !== undefined && hit > 0 && hit < THRESHOLDS.minHitChance) {
    add(
      "warning",
      "hit-chance",
      `${Math.round(hit)}% chance to hit`,
      `About 1 in ${Math.round(100 / (100 - hit))} attacks miss. More accuracy is often a cheap damage gain.`,
    );
  }

  // Attribute requirements.
  for (const [key, name] of ATTRIBUTES) {
    const have = s[key];
    const need = s[`Req${key}`];
    if (have !== undefined && need !== undefined && have < need) {
      add(
        "warning",
        `attr-${key}`,
        `Not enough ${name.toLowerCase()}: ${num(have)} / ${num(need)}`,
        "In game, items and gems that need more are disabled until you meet the requirement.",
      );
    }
  }

  // Pool size.
  const pool = (s.Life ?? 0) + (s.EnergyShield ?? 0);
  if (level >= THRESHOLDS.poolLevel && has(s, "Life") && pool < THRESHOLDS.minPool) {
    add(
      "warning",
      "pool",
      "Small life pool",
      `${num(s.Life)} life + ${num(s.EnergyShield ?? 0)} energy shield at level ${level}. Mitigation helps (effective HP ${num(s.TotalEHP ?? 0)}), but a large pool is what survives the biggest hits.`,
    );
  }

  // Spell suppression invested but not capped.
  const sup = s.EffectiveSpellSuppressionChance ?? 0;
  if (sup >= THRESHOLDS.suppressionInvested && sup < 100) {
    add("info", "suppression", `Spell suppression ${Math.round(sup)}%`, "Not capped: it only helps fully at 100%.");
  }

  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
}

/** Findings an item swap adds or removes, compared by id. */
export function diffFindings(before: Finding[], after: Finding[]) {
  const ids = (list: Finding[]) => new Set(list.map((f) => f.id));
  const beforeIds = ids(before);
  const afterIds = ids(after);
  return {
    added: after.filter((f) => !beforeIds.has(f.id)),
    removed: before.filter((f) => !afterIds.has(f.id)),
  };
}
