import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ReadableStream, TransformStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const endpoint = "https://mcp-api.op.gg/mcp";
const toolNames = [
  "lol_list_lane_meta_champions",
  "lol_get_lane_matchup_guide",
  "lol_get_champion_analysis",
  "lol_get_champion_synergies",
  "lol_list_champions",
] as const;
const positions = ["top", "jungle", "mid", "adc", "support"] as const;
const laneMetaFieldRequest =
  "champion,is_rip,play,win,kill,win_rate,pick_rate,role_rate,ban_rate,kda,tier,rank,rank_prev,rank_prev_patch";
const analysisSynergyFieldRequest = [
  "data.synergies.jungle[].{champion_id,champion_name,position,synergy_champion_id,synergy_champion_name,synergy_position,score_rank,score,play,win,win_rate}",
  "data.synergies.jungle[].synergy_tier_data.{tier,rank,rank_prev,rank_prev_patch}",
];
const analysisAllSynergyFieldRequest = positions.flatMap((position) => [
  `data.synergies.${position}[].{champion_id,champion_name,position,synergy_champion_id,synergy_champion_name,synergy_position,score_rank,score,play,win,win_rate}`,
  `data.synergies.${position}[].synergy_tier_data.{tier,rank,rank_prev,rank_prev_patch}`,
]);
const damageTypeProbeChampions = [
  { champion: "JINX", position: "adc" },
  { champion: "ORIANNA", position: "mid" },
  { champion: "JAYCE", position: "top" },
] as const;
const synergyTierProbeChampions = [
  { champion: "AHRI", position: "mid" },
  { champion: "ORIANNA", position: "mid" },
  { champion: "JINX", position: "adc" },
  { champion: "YASUO", position: "mid" },
  { champion: "MALPHITE", position: "top" },
  { champion: "AMUMU", position: "jungle" },
  { champion: "YUUMI", position: "support" },
] as const;

type ToolName = (typeof toolNames)[number];

interface ProbeCall {
  name: ToolName;
  arguments: Record<string, unknown>;
  fallbackArguments?: Record<string, unknown>;
}

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const probeCalls: ProbeCall[] = [
  {
    name: "lol_list_lane_meta_champions",
    arguments: {
      game_mode: "ranked",
      position: "mid",
      tier: "all",
      lang: "en_US",
    },
    fallbackArguments: {
      game_mode: "ranked",
      position: "mid",
      tier: "all",
      lang: "en_US",
      desired_output_fields: [
        "data[].{champion_id,champion_name,position,tier,rank,rank_prev,rank_prev_patch,win_rate,pick_rate,ban_rate,play}",
        "data.{champion_id,champion_name,position,tier,rank,rank_prev,rank_prev_patch,win_rate,pick_rate,ban_rate,play}",
      ],
    },
  },
  {
    name: "lol_get_lane_matchup_guide",
    arguments: {
      position: "mid",
      my_champion: "AHRI",
      opponent_champion: "YASUO",
      lang: "en_US",
    },
  },
  {
    name: "lol_get_champion_analysis",
    arguments: {
      game_mode: "ranked",
      champion: "AHRI",
      position: "mid",
      lang: "en_US",
    },
    fallbackArguments: {
      game_mode: "ranked",
      champion: "AHRI",
      position: "mid",
      lang: "en_US",
      desired_output_fields: [
        "data.summary.average_stats.{win_rate,pick_rate,ban_rate,tier,rank,play}",
        "data.summary.average_stats.tier_data.{tier,rank,rank_prev,rank_prev_patch}",
        "data.weak_counters[].{champion_id,champion_name,play,win,win_rate}",
        "data.strong_counters[].{champion_id,champion_name,play,win,win_rate}",
        "data.synergies.*[].{champion_id,champion_name,position,score,score_rank,synergy_champion_id,synergy_champion_name,synergy_position,play,win,win_rate}",
      ],
    },
  },
  {
    name: "lol_get_champion_synergies",
    arguments: {
      champion: "AHRI",
      my_position: "mid",
      synergy_position: "jungle",
      lang: "en_US",
    },
    fallbackArguments: {
      champion: "AHRI",
      my_position: "mid",
      synergy_position: "jungle",
      lang: "en_US",
      desired_output_fields: [
        "data.synergies[].{champion_id,champion_name,position,score,score_rank,synergy_champion_id,synergy_champion_name,synergy_position,play,win,win_rate}",
        "data.synergies[].synergy_tier_data.{tier,rank,rank_prev,rank_prev_patch}",
      ],
    },
  },
  {
    name: "lol_list_champions",
    arguments: {
      lang: "en_US",
    },
    fallbackArguments: {
      lang: "en_US",
      desired_output_fields: [
        "data[].{id,key,name,slug,champion_id,champion_name}",
        "data.{id,key,name,slug,champion_id,champion_name}",
      ],
    },
  },
];

async function main(): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true });

  (globalThis as unknown as { TransformStream?: typeof TransformStream }).TransformStream ??=
    TransformStream;
  (globalThis as unknown as { ReadableStream?: typeof ReadableStream }).ReadableStream ??=
    ReadableStream;
  assertFetchAvailable();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const client = new Client({ name: "draft-coach-opgg-probe", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);

  try {
    if (process.argv.includes("damage-type")) {
      await saveDamageTypeProbe(client);
      return;
    }

    if (process.argv.includes("synergy-tier")) {
      await saveSynergyTierProbe(client);
      return;
    }

    const tools = await client.listTools();
    const relevantTools = tools.tools.filter((tool) => toolNames.includes(tool.name as ToolName));

    await saveFixture("list-tools", relevantTools);
    console.log(`Saved schemas for ${relevantTools.length} tools`);

    for (const probeCall of probeCalls) {
      console.log(`Calling ${probeCall.name}`);
      const result = await callWithFallback(client, probeCall);
      await saveFixture(probeCall.name, result);
      console.log(`Saved ${probeCall.name}`);
    }

    console.log("Calling champion-positions fallback via lol_list_lane_meta_champions");
    await saveFixture("champion-positions", {
      path: "lane-meta-all-positions-fallback",
      tool: "lol_list_lane_meta_champions",
      response: await client.callTool({
        name: "lol_list_lane_meta_champions",
        arguments: {
          lang: "en_US",
          position: "all",
          desired_output_fields: positions.map(
            (position) => `data.positions.${position}[].{${laneMetaFieldRequest}}`,
          ),
        },
      }),
    });
    console.log("Saved champion-positions");

    const allPositionsArgs = {
      lang: "en_US",
      position: "all",
      desired_output_fields: positions.map(
        (position) => `data.positions.${position}[].{${laneMetaFieldRequest}}`,
      ),
    };
    const baseMetaArgs = {
      lang: "en_US",
      position: "jungle",
      desired_output_fields: [`data.positions.jungle[].{${laneMetaFieldRequest}}`],
    };

    console.log("Calling extended position/base-meta probes");
    await saveFixture("positions-json", {
      note: "OP.GG currently returns typed text; format=json is ignored if unsupported.",
      arguments: { ...allPositionsArgs, format: "json" },
      response: await client.callTool({
        name: "lol_list_lane_meta_champions",
        arguments: { ...allPositionsArgs, format: "json" },
      }),
    });
    await saveTextFixture(
      "positions-csv",
      await callToolText(client, "lol_list_lane_meta_champions", allPositionsArgs),
    );
    await saveFixture("base-meta-json", {
      note: "OP.GG currently returns typed text; format=json is ignored if unsupported.",
      arguments: { ...baseMetaArgs, format: "json" },
      response: await client.callTool({
        name: "lol_list_lane_meta_champions",
        arguments: { ...baseMetaArgs, format: "json" },
      }),
    });
    await saveTextFixture(
      "base-meta-csv",
      await callToolText(client, "lol_list_lane_meta_champions", baseMetaArgs),
    );
    await saveFixture("counter-json", {
      note: "OP.GG currently returns typed text for selected counter fields.",
      response: await client.callTool({
        name: "lol_get_champion_analysis",
        arguments: {
          game_mode: "ranked",
          champion: "AHRI",
          position: "mid",
          lang: "en_US",
          desired_output_fields: [
            "data.weak_counters[].{champion_id,champion_name,play,win,win_rate}",
            "data.strong_counters[].{champion_id,champion_name,play,win,win_rate}",
          ],
        },
      }),
    });
    await saveFixture("synergy-json", {
      note: "OP.GG currently returns typed text for selected synergy fields.",
      response: await client.callTool({
        name: "lol_get_champion_synergies",
        arguments: {
          champion: "ORIANNA",
          my_position: "mid",
          synergy_position: "jungle",
          lang: "en_US",
          desired_output_fields: [
            "data.synergies[].{champion_id,champion_name,position,score,score_rank,synergy_champion_id,synergy_champion_name,synergy_position,play,win,win_rate}",
            "data.synergies[].synergy_tier_data.{tier,rank,rank_prev,rank_prev_patch}",
          ],
        },
      }),
    });
    for (const champion of ["ORIANNA", "LISSANDRA", "RIVEN"] as const) {
      await saveFixture(`analysis-${champion.toLowerCase()}`, {
        note:
          "Role-scoped synergy partners from lol_get_champion_analysis; rows are data.synergies.jungle[].",
        anchor:
          champion === "ORIANNA"
            ? "Nocturne appears as a listed jungle partner with >2k games."
            : champion === "LISSANDRA"
              ? "Nocturne is absent in the jungle partner list; this is the unrelated-control fixture."
              : "Nocturne appears with tiny sample only; scoring should suppress this chip.",
        response: await client.callTool({
          name: "lol_get_champion_analysis",
          arguments: {
            game_mode: "ranked",
            champion,
            position: "mid",
            lang: "en_US",
            desired_output_fields: analysisSynergyFieldRequest,
          },
        }),
      });
    }
    await saveDamageTypeProbe(client);
    console.log("Saved extended probes");
  } finally {
    await client.close();
  }
}

function assertFetchAvailable(): void {
  if (typeof globalThis.fetch !== "function") {
    throw new Error(
      "OP.GG probe requires Node 18+ fetch support. Use a Node 18+ runtime to run scripts/opgg-probe.ts.",
    );
  }
}

async function saveDamageTypeProbe(client: Client): Promise<void> {
  console.log("Calling damage_type champion-analysis probes");
  await saveFixture("analysis-damage-type", {
    note: "Phase 6 damage_type probe. OP.GG returns Data.damage_type as AD/AP/BOTH text.",
    desired_output_fields: ["data.{damage_type,mythic_items}"],
    calls: await Promise.all(
      damageTypeProbeChampions.map(async ({ champion, position }) => ({
        champion,
        position,
        response: await client.callTool({
          name: "lol_get_champion_analysis",
          arguments: {
            game_mode: "ranked",
            champion,
            position,
            lang: "en_US",
            desired_output_fields: ["data.{damage_type,mythic_items}"],
          },
        }),
      })),
    ),
  });
  console.log("Saved analysis-damage-type");
}

async function saveSynergyTierProbe(client: Client): Promise<void> {
  console.log("Calling synergy_tier_data champion-analysis probes");
  await saveFixture("analysis-synergy-tier", {
    note:
      "Phase 8 synergy tier probe. OP.GG returns synergy_tier_data.tier where lower is stronger (0=OP, 4=C).",
    desired_output_fields: analysisAllSynergyFieldRequest,
    calls: await Promise.all(
      synergyTierProbeChampions.map(async ({ champion, position }) => ({
        champion,
        position,
        response: await client.callTool({
          name: "lol_get_champion_analysis",
          arguments: {
            game_mode: "ranked",
            champion,
            position,
            lang: "en_US",
            desired_output_fields: analysisAllSynergyFieldRequest,
          },
        }),
      })),
    ),
  });
  console.log("Saved analysis-synergy-tier");
}

async function callWithFallback(client: Client, probeCall: ProbeCall): Promise<unknown> {
  try {
    return {
      attemptedArguments: probeCall.arguments,
      usedFallback: false,
      response: await client.callTool({
        name: probeCall.name,
        arguments: probeCall.arguments,
      }),
    };
  } catch (error) {
    if (!probeCall.fallbackArguments) {
      return {
        attemptedArguments: probeCall.arguments,
        usedFallback: false,
        error: formatError(error),
      };
    }

    return {
      attemptedArguments: probeCall.arguments,
      fallbackArguments: probeCall.fallbackArguments,
      usedFallback: true,
      firstError: formatError(error),
      response: await client.callTool({
        name: probeCall.name,
        arguments: probeCall.fallbackArguments,
      }),
    };
  }
}

async function saveFixture(name: string, value: unknown): Promise<void> {
  await writeFile(join(fixtureDirectory, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

async function saveTextFixture(name: string, value: string): Promise<void> {
  await writeFile(join(fixtureDirectory, `${name}.txt`), value);
}

async function callToolText(
  client: Client,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await client.callTool({ name, arguments: args });
  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const textItem = content.find((item) => item.type === "text");

  return textItem?.text ?? "";
}

function formatError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
