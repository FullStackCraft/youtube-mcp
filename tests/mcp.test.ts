import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";
import type { YoutubeRuntime } from "../src/runtime.js";
import type { AccessMode } from "../src/types.js";
import { FakeGateway } from "./helpers/fake-gateway.js";

const closers: Array<() => Promise<void>> = [];

async function connected(mode: AccessMode) {
  const gateway = new FakeGateway();
  const runtime: YoutubeRuntime = {
    profileName: "test",
    mode,
    async getAuthStatus() {
      return {
        profile: "test",
        mode,
        authenticated: true,
        channelId: "channel-1",
        channelTitle: "Test Channel",
        grantedScopes: [],
        missingScopes: [],
        needsLogin: false,
        message: "Configured",
      };
    },
    async getGateway() {
      return { gateway, channelId: "channel-1" };
    },
  };
  const server = createMcpServer(runtime);
  const client = new Client({ name: "youtube-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, gateway };
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe("MCP tool surface", () => {
  it("exposes ten read tools in readonly mode", async () => {
    const { client } = await connected("readonly");
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "youtube_get_auth_status",
        "youtube_get_channel_analytics",
        "youtube_get_my_channel",
        "youtube_get_video",
        "youtube_get_video_analytics",
        "youtube_get_video_retention",
        "youtube_get_video_search_terms",
        "youtube_get_video_traffic_sources",
        "youtube_list_my_videos",
        "youtube_list_video_categories",
      ].sort(),
    );
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("adds only preview and apply in manage mode", async () => {
    const { client } = await connected("manage");
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(12);
    const apply = tools.tools.find((tool) => tool.name === "youtube_apply_video_update");
    expect(apply?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
  });

  it("returns structured content and applies the exact preview", async () => {
    const { client, gateway } = await connected("manage");
    const previewResult = await client.callTool({
      name: "youtube_preview_video_update",
      arguments: { videoId: "video-1", title: "Updated through MCP" },
    });
    expect(previewResult.isError).not.toBe(true);
    const previewEnvelope = previewResult.structuredContent as any;
    expect(previewEnvelope.ok).toBe(true);
    const preview = previewEnvelope.data;
    const applyResult = await client.callTool({
      name: "youtube_apply_video_update",
      arguments: {
        previewId: preview.previewId,
        previewHash: preview.previewHash,
        confirmVideoId: "video-1",
      },
    });
    expect((applyResult.structuredContent as any).data.verified).toBe(true);
    expect(gateway.video.snippet.title).toBe("Updated through MCP");
  });

  it("returns stable structured errors", async () => {
    const { client } = await connected("readonly");
    const result = await client.callTool({
      name: "youtube_get_video",
      arguments: { videoId: "not-owned" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "YOUTUBE_API_ERROR", retriable: false },
    });
  });
});
