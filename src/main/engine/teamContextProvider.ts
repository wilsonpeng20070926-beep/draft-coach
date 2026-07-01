import type { ChampionAttributeProvider } from "../catalog/championAttributes";
import type { MetaDataSource } from "../data/metaDataSource";
import { buildTeamContext } from "../draft/teamContext";
import type { DamageStyle, TeamContext } from "../../shared/championAttributes";
import type { DraftPlayer, DraftState } from "../../shared/types";

export interface AnalysisBackedTeamContextOptions {
  region: string;
  rank: string;
}

export async function buildAnalysisBackedTeamContext(
  draft: DraftState,
  metaSource: MetaDataSource,
  attributeProvider: ChampionAttributeProvider,
  options: AnalysisBackedTeamContextOptions,
): Promise<TeamContext> {
  const damageStyles = await loadLockedDamageStyles(draft, metaSource, options);

  return buildTeamContext(draft, (champion) =>
    attributeProvider.getAttributes(champion, damageStyles.get(champion.id)),
  );
}

async function loadLockedDamageStyles(
  draft: DraftState,
  metaSource: MetaDataSource,
  options: AnalysisBackedTeamContextOptions,
): Promise<Map<number, DamageStyle>> {
  const damageStyles = new Map<number, DamageStyle>();

  if (!metaSource.getChampionAnalysis) {
    return damageStyles;
  }

  await Promise.all(
    [...draft.allies, ...draft.enemies]
      .filter(hasChampionAndRole)
      .map(async (player) => {
        try {
          const analysis = await metaSource.getChampionAnalysis!(
            player.champion,
            player.role,
            options.region,
            options.rank,
          );

          damageStyles.set(player.champion.id, analysis.damageStyle);
        } catch {
          damageStyles.set(player.champion.id, "unknown");
        }
      }),
  );

  return damageStyles;
}

function hasChampionAndRole(
  player: DraftPlayer,
): player is DraftPlayer & {
  champion: NonNullable<DraftPlayer["champion"]>;
  role: NonNullable<DraftPlayer["role"]>;
} {
  return player.champion !== null && player.role !== null;
}
