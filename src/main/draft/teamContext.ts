import type {
  ChampionAttributes,
  CompNeed,
  CompNeedKind,
  CompThreat,
  CompThreatKind,
  GetChampionAttributes,
  TeamComposition,
  TeamContext,
} from "../../shared/championAttributes";
import type {
  ChampionRef,
  DraftPlayer,
  DraftState,
  DraftTarget,
} from "../../shared/types";

interface TeamMember {
  champion: ChampionRef;
  attributes: ChampionAttributes;
  roleConfidence: number;
}

const needOrder: CompNeedKind[] = [
  "ap",
  "ad",
  "frontline",
  "engage",
  "peel",
  "cc",
  "waveclear",
  "range",
];
const threatOrder: CompThreatKind[] = [
  "dive",
  "burst-ap",
  "burst-ad",
  "poke",
  "hard-engage",
  "scaling-carry",
];

export function buildTeamContext(
  draft: DraftState,
  getAttributes: GetChampionAttributes,
  target?: DraftTarget | null,
): TeamContext {
  const allies = collectTeamMembers(draft.allies, getAttributes, false, target);
  const enemies = collectTeamMembers(draft.enemies, getAttributes, true, target);
  const ally = buildComposition(allies);
  const enemy = buildComposition(enemies);

  return {
    ally,
    enemy,
    allyNeeds: deriveAllyNeeds(ally),
    enemyThreats: deriveEnemyThreats(enemy),
    confidence: calculateContextConfidence(ally, enemy),
  };
}

function collectTeamMembers(
  players: DraftPlayer[],
  getAttributes: GetChampionAttributes,
  useRoleConfidence: boolean,
  target?: DraftTarget | null,
): TeamMember[] {
  return players
    .filter(
      (player): player is DraftPlayer & { champion: ChampionRef } =>
        player.pickState === "locked" &&
        player.champion !== null &&
        !(target && player.side === target.side && player.cellId === target.cellId),
    )
    .map((player) => ({
      champion: player.champion,
      attributes: getAttributes(player.champion),
      roleConfidence: useRoleConfidence ? resolveRoleConfidence(player) : 1,
    }));
}

function buildComposition(members: TeamMember[]): TeamComposition {
  if (members.length === 0) {
    return emptyComposition();
  }

  let adDamage = 0;
  let apDamage = 0;
  let knownDamageWeight = 0;
  let rangedCount = 0;
  let roleConfidenceSum = 0;
  let attributeConfidenceSum = 0;
  const powerCurve = { early: 0, mid: 0, late: 0 };
  let powerCurveWeight = 0;

  for (const member of members) {
    const confidence = member.roleConfidence;
    const mix = damageMix(member.attributes.damageStyle);

    if (mix.known) {
      adDamage += mix.ad * confidence;
      apDamage += mix.ap * confidence;
      knownDamageWeight += confidence;
    }

    if (member.attributes.range === "ranged") {
      rangedCount += confidence;
    } else if (member.attributes.range === "mixed") {
      rangedCount += 0.5 * confidence;
    }

    if (member.attributes.powerCurve in powerCurve) {
      powerCurve[member.attributes.powerCurve as keyof typeof powerCurve] += confidence;
      powerCurveWeight += confidence;
    }

    roleConfidenceSum += confidence;
    attributeConfidenceSum += member.attributes.attributeConfidence;
  }

  const totalDamage = adDamage + apDamage;

  return {
    adWeight: totalDamage > 0 ? adDamage / totalDamage : 0,
    apWeight: totalDamage > 0 ? apDamage / totalDamage : 0,
    engage: saturatingSignal(members, (attributes) => attributes.engage),
    peel: saturatingSignal(members, (attributes) => attributes.peel),
    frontline: saturatingSignal(members, (attributes) => attributes.frontline),
    poke: saturatingSignal(members, (attributes) => attributes.poke),
    waveclear: saturatingSignal(members, (attributes) => attributes.waveclear),
    cc: saturatingSignal(members, (attributes) => attributes.cc),
    mobility: saturatingSignal(members, (attributes) => attributes.mobility),
    carryPotential: saturatingSignal(members, (attributes) => attributes.carryPotential),
    rangedCount,
    powerCurve: {
      early: powerCurveWeight > 0 ? powerCurve.early / powerCurveWeight : 0,
      mid: powerCurveWeight > 0 ? powerCurve.mid / powerCurveWeight : 0,
      late: powerCurveWeight > 0 ? powerCurve.late / powerCurveWeight : 0,
    },
    championCount: members.length,
    averageRoleConfidence: roleConfidenceSum / members.length,
    averageAttributeConfidence: attributeConfidenceSum / members.length,
  };
}

function deriveAllyNeeds(ally: TeamComposition): CompNeed[] {
  if (ally.championCount === 0) {
    return [];
  }

  const needs: CompNeed[] = [];
  const damageImbalance = ally.adWeight - ally.apWeight;

  if (damageImbalance > 0.3) {
    needs.push(createNeed("ap", normalizeRange(damageImbalance, 0.3, 0.9)));
  } else if (damageImbalance < -0.3) {
    needs.push(createNeed("ad", normalizeRange(Math.abs(damageImbalance), 0.3, 0.9)));
  }

  if (ally.frontline < 0.45 && (ally.rangedCount > 0 || ally.carryPotential > 0.55)) {
    needs.push(createNeed("frontline", normalizeRange(0.45 - ally.frontline, 0, 0.45)));
  }

  if (ally.engage < 0.35) {
    needs.push(createNeed("engage", normalizeRange(0.35 - ally.engage, 0, 0.35)));
  }

  if (ally.carryPotential > 0.55 && ally.peel < 0.45) {
    needs.push(createNeed("peel", normalizeRange(0.45 - ally.peel, 0, 0.45)));
  }

  if (ally.cc < 0.35) {
    needs.push(createNeed("cc", normalizeRange(0.35 - ally.cc, 0, 0.35)));
  }

  if (ally.waveclear < 0.35) {
    needs.push(createNeed("waveclear", normalizeRange(0.35 - ally.waveclear, 0, 0.35)));
  }

  if (ally.rangedCount / ally.championCount < 0.35 && ally.poke < 0.45) {
    needs.push(createNeed("range", normalizeRange(0.35 - ally.rangedCount / ally.championCount, 0, 0.35)));
  }

  return sortNeeds(needs);
}

function deriveEnemyThreats(enemy: TeamComposition): CompThreat[] {
  if (enemy.championCount === 0 || enemy.averageRoleConfidence < 0.25) {
    return [];
  }

  const threats: CompThreat[] = [];
  const roleScale = enemy.averageRoleConfidence;
  const diveRaw = enemy.engage * 0.45 + enemy.mobility * 0.35 + enemy.carryPotential * 0.2;
  const hardEngageRaw = enemy.engage * 0.7 + enemy.cc * 0.3;
  const burstApRaw = enemy.apWeight * enemy.carryPotential * roleScale;
  const burstAdRaw = enemy.adWeight * enemy.carryPotential * roleScale;

  pushThreat(threats, "dive", normalizeRange(diveRaw, 0.45, 0.9) * roleScale);
  pushThreat(threats, "hard-engage", normalizeRange(hardEngageRaw, 0.5, 0.9) * roleScale);
  pushThreat(threats, "poke", normalizeRange(enemy.poke, 0.5, 0.9) * roleScale);
  pushThreat(threats, "burst-ap", normalizeRange(burstApRaw, 0.35, 0.85));
  pushThreat(threats, "burst-ad", normalizeRange(burstAdRaw, 0.35, 0.85));
  pushThreat(
    threats,
    "scaling-carry",
    normalizeRange(enemy.powerCurve.late * 0.45 + enemy.carryPotential * 0.55, 0.45, 0.85) *
      roleScale,
  );

  return sortThreats(threats);
}

function calculateContextConfidence(ally: TeamComposition, enemy: TeamComposition): number {
  const lockedChampionCount = ally.championCount + enemy.championCount;
  const lockConfidence = clamp01(lockedChampionCount / 10);
  const allyLockConfidence = clamp01(ally.championCount / 5);
  const enemyRoleConfidence =
    enemy.championCount > 0 ? enemy.averageRoleConfidence * clamp01(enemy.championCount / 5) : 0;
  const attributeConfidence =
    lockedChampionCount > 0
      ? (ally.averageAttributeConfidence * ally.championCount +
          enemy.averageAttributeConfidence * enemy.championCount) /
        lockedChampionCount
      : 0;

  return clamp01(lockConfidence * 0.25 + allyLockConfidence * 0.35 + enemyRoleConfidence * 0.25 + attributeConfidence * 0.15);
}

function createNeed(kind: CompNeedKind, severity: number): CompNeed {
  return {
    kind,
    severity: clamp01(severity),
  };
}

function pushThreat(threats: CompThreat[], kind: CompThreatKind, severity: number): void {
  const clamped = clamp01(severity);

  if (clamped >= 0.05) {
    threats.push({ kind, severity: clamped });
  }
}

function sortNeeds(needs: CompNeed[]): CompNeed[] {
  return [...needs].sort((left, right) => {
    if (right.severity !== left.severity) {
      return right.severity - left.severity;
    }

    return needOrder.indexOf(left.kind) - needOrder.indexOf(right.kind);
  });
}

function sortThreats(threats: CompThreat[]): CompThreat[] {
  return [...threats].sort((left, right) => {
    if (right.severity !== left.severity) {
      return right.severity - left.severity;
    }

    return threatOrder.indexOf(left.kind) - threatOrder.indexOf(right.kind);
  });
}

function saturatingSignal(
  members: TeamMember[],
  select: (attributes: ChampionAttributes) => number,
): number {
  return clamp01(
    1 - members.reduce((remaining, member) => remaining * (1 - select(member.attributes) * member.roleConfidence), 1),
  );
}

function damageMix(damageStyle: ChampionAttributes["damageStyle"]): {
  ad: number;
  ap: number;
  known: boolean;
} {
  if (damageStyle === "ad") {
    return { ad: 1, ap: 0, known: true };
  }

  if (damageStyle === "ap") {
    return { ad: 0, ap: 1, known: true };
  }

  if (damageStyle === "hybrid" || damageStyle === "true") {
    return { ad: 0.5, ap: 0.5, known: true };
  }

  return { ad: 0, ap: 0, known: false };
}

function resolveRoleConfidence(player: DraftPlayer): number {
  if (player.roleSource === "assigned") {
    return 1;
  }

  return clamp01(player.roleConfidence ?? 0.4);
}

function emptyComposition(): TeamComposition {
  return {
    adWeight: 0,
    apWeight: 0,
    engage: 0,
    peel: 0,
    frontline: 0,
    poke: 0,
    waveclear: 0,
    cc: 0,
    mobility: 0,
    carryPotential: 0,
    rangedCount: 0,
    powerCurve: {
      early: 0,
      mid: 0,
      late: 0,
    },
    championCount: 0,
    averageRoleConfidence: 0,
    averageAttributeConfidence: 0,
  };
}

function normalizeRange(value: number, low: number, high: number): number {
  if (high <= low) {
    return 0;
  }

  return clamp01((value - low) / (high - low));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
