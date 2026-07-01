import type { ChampionAttributes } from "../../shared/championAttributes";

export type ChampionAttributeOverride = Partial<
  Omit<ChampionAttributes, "championId" | "attributeConfidence">
>;

export const championAttributeOverrides: Record<number, ChampionAttributeOverride> = {
  // why: Amumu is an AP engage tank whose Data Dragon Tank tag would otherwise imply AD.
  32: { damageStyle: "ap", engage: 0.95, frontline: 0.8, cc: 0.95, mobility: 0.35 },

  // why: Malphite's identity is hard initiation, not just generic tankiness.
  54: { damageStyle: "ap", engage: 0.95, frontline: 0.85, cc: 0.85, mobility: 0.45 },

  // why: Jarvan IV is a primary engage jungler despite mixed Tank/Fighter tags.
  59: { engage: 0.9, frontline: 0.75, cc: 0.75, mobility: 0.65 },

  // why: Wukong is a dive/engage skirmisher with stronger initiation than his tags imply.
  62: { engage: 0.8, mobility: 0.65, cc: 0.65 },

  // why: Orianna is a control mage with unusually high peel and wave control.
  61: { peel: 0.75, waveclear: 0.85, cc: 0.7, powerCurve: "mid" },

  // why: Xerath is long-range poke with little peel or frontline value.
  101: { poke: 0.95, waveclear: 0.8, range: "ranged", frontline: 0.05, peel: 0.2 },

  // why: Nocturne is a dive assassin/fighter whose engage threat comes from ultimate access.
  56: { engage: 0.85, mobility: 0.8, carryPotential: 0.8, powerCurve: "mid" },

  // why: Jinx is a late-game ranged carry with little engage or self-peel.
  222: { carryPotential: 0.95, powerCurve: "late", range: "ranged", peel: 0.05 },

  // why: Thresh is a high-peel support who also offers pick engage.
  412: { engage: 0.75, peel: 0.9, cc: 0.85, range: "ranged" },

  // why: Senna is a ranged marksman-support with poke and peel, not a pure ADC.
  235: { range: "ranged", peel: 0.65, poke: 0.75, carryPotential: 0.7 },

  // why: Pyke is an assassin support with pick engage and mobility, not an enchanter.
  555: { damageStyle: "ad", engage: 0.75, peel: 0.15, mobility: 0.9, carryPotential: 0.55 },

  // why: Sett is a frontline brawler with meaningful peel through displacement.
  875: { frontline: 0.8, peel: 0.55, engage: 0.55, cc: 0.65 },
};
