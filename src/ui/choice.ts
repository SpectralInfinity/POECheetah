import type { BuildChoice } from "../core/compare";

// The tier and main skill chosen for each saved build (design doc §3.14),
// shared with the item check pop-out.
const KEY = (buildId: number) => `poecheetah.choice.${buildId}`;

export function savedChoice(buildId: number): BuildChoice {
  try {
    return JSON.parse(localStorage.getItem(KEY(buildId)) ?? "{}");
  } catch {
    return {};
  }
}

export function saveChoice(buildId: number, choice: BuildChoice): void {
  try {
    localStorage.setItem(KEY(buildId), JSON.stringify(choice));
  } catch {
    // Not remembering the choice is fine.
  }
}
