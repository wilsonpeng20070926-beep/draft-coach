import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LeaguepediaCargoAdapter,
  type CargoFetch,
} from "../src/main/data/pro/leaguepediaCargo";
import { APP_VERSION } from "../src/shared/appInfo";
import { createFixtureCatalog } from "./fixtures/championFixture";

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "scripts/fixtures/leaguepedia-cargo-page.json"),
    "utf8",
  ),
) as unknown;

describe("Leaguepedia Cargo adapter", () => {
  it("paginates conservatively and normalizes aliases, roles, order, format, and exclusions", async () => {
    const urls: string[] = [];
    const headers: Array<HeadersInit | undefined> = [];
    const delays: number[] = [];
    const pages = [fixture, { cargoquery: [] }];
    const fetchImpl: CargoFetch = async (url, init) => {
      urls.push(url);
      headers.push(init.headers);
      return response(200, pages.shift() ?? { cargoquery: [] }, { etag: '"v1"' });
    };
    const adapter = new LeaguepediaCargoAdapter(createFixtureCatalog(), {
      pageSize: 2,
      minimumRequestIntervalMs: 100,
      fetchImpl,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const result = await adapter.fetchDrafts(
      ["26.13", "26.12", "26.11"],
      '"previous"',
    );

    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]).searchParams.get("offset")).toBe("0");
    expect(new URL(urls[1]).searchParams.get("offset")).toBe("2");
    expect(new URL(urls[0]).searchParams.get("tables")).toBe(
      "ScoreboardGames=SG,PicksAndBansS7=PB",
    );
    expect(new URL(urls[0]).searchParams.get("join_on")).toBe(
      "SG.GameId=PB.GameId",
    );
    expect(new URL(urls[0]).searchParams.get("where")).toContain(
      "NOT LIKE '%Academy%'",
    );
    expect(headers[0]).toMatchObject({ "If-None-Match": '"previous"' });
    expect(headers[1]).not.toHaveProperty("If-None-Match");
    expect(delays).toEqual([100]);
    expect(result.etag).toBe('"v1"');
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      gameId: "LCK_2026_001",
      patch: "26.13",
      playedAt: "2026-07-01T10:30:00.000Z",
      competitionTier: "major",
      winner: "blue",
      fearless: true,
    });
    expect(
      result.drafts[0].picks.slice(0, 3).map((pick) => [pick.order, pick.side, pick.role, pick.championId]),
    ).toEqual([
      [1, "blue", "top", 266],
      [2, "red", "top", 122],
      [3, "red", "jungle", 62],
    ]);
    expect(result.drafts[0].bans.map((ban) => ban.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("backs off retryable responses and sends conditional headers", async () => {
    const delays: number[] = [];
    const headers: Array<HeadersInit | undefined> = [];
    let call = 0;
    const adapter = new LeaguepediaCargoAdapter(createFixtureCatalog(), {
      pageSize: 100,
      minimumRequestIntervalMs: 0,
      maxRetries: 1,
      fetchImpl: async (_url, init) => {
        headers.push(init.headers);
        call += 1;
        return call === 1
          ? response(429, {})
          : response(304, {}, { etag: '"same"' });
      },
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const result = await adapter.fetchDrafts(["26.13"], '"previous"');

    expect(result.notModified).toBe(true);
    expect(delays).toEqual([500]);
    expect(headers[0]).toMatchObject({
      "If-None-Match": '"previous"',
      "User-Agent": `DraftCoach-ProSnapshot/${APP_VERSION} (+https://github.com/wilsonpeng20070926-beep/draft-coach)`,
    });
  });

  it("treats HTTP-200 Cargo rate-limit errors as retryable instead of empty data", async () => {
    const delays: number[] = [];
    let call = 0;
    const adapter = new LeaguepediaCargoAdapter(createFixtureCatalog(), {
      pageSize: 100,
      minimumRequestIntervalMs: 0,
      maxRetries: 1,
      fetchImpl: async () => {
        call += 1;
        return call === 1
          ? response(200, {
              error: { code: "ratelimited", info: "wait before retrying" },
            })
          : response(200, fixture);
      },
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const result = await adapter.fetchDrafts(["26.13"]);

    expect(result.drafts).toHaveLength(1);
    expect(delays).toEqual([500]);
  });

  it("authenticates with a bot password and carries the session cookie into Cargo queries", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let call = 0;
    const adapter = new LeaguepediaCargoAdapter(createFixtureCatalog(), {
      minimumRequestIntervalMs: 0,
      authentication: {
        username: "VerifiedUser@DraftCoach",
        botPassword: "test-secret",
      },
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        call += 1;

        if (call === 1) {
          return response(200, {
            query: { tokens: { logintoken: "token+\\" } },
          }, { "set-cookie": "session=anonymous; Path=/; HttpOnly" });
        }

        if (call === 2) {
          return response(200, {
            login: { result: "Success" },
          }, { "set-cookie": "session=authenticated; Path=/; HttpOnly" });
        }

        return response(200, fixture);
      },
    });

    const result = await adapter.fetchDrafts(["26.13"]);

    expect(result.drafts).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      url: "https://lol.fandom.com/api.php",
      init: { method: "POST" },
    });
    expect(String(requests[1].init.body)).toContain("lgname=VerifiedUser%40DraftCoach");
    expect(requests[1].init.headers).toMatchObject({ Cookie: "session=anonymous" });
    expect(requests[2].init.method).toBe("GET");
    expect(requests[2].init.headers).toMatchObject({ Cookie: "session=authenticated" });
  });
});

function response(
  status: number,
  body: unknown,
  headerValues: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headerValues[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
  };
}
