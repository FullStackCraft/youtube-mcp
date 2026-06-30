import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { asAppError } from "../errors.js";
import { validateDateRange } from "../domain/dates.js";
import { MetadataUpdateService, PreviewStore } from "../domain/metadata.js";
import type { YoutubeRuntime } from "../runtime.js";

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retriable: z.boolean(),
});

const MetaSchema = z.object({
  profile: z.string(),
  mode: z.enum(["readonly", "manage"]),
  channelId: z.string().optional(),
  estimatedYouTubeDataQuotaUnits: z.number().int().nonnegative().optional(),
});

const EnvelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: ErrorSchema.optional(),
  meta: MetaSchema,
});

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const LOCAL_READ_ANNOTATIONS: ToolAnnotations = {
  ...READ_ANNOTATIONS,
  openWorldHint: false,
};

const PREVIEW_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const APPLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const VideoIdSchema = z.string().min(1).max(64);
const DateRangeSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});
const VideoDateRangeSchema = DateRangeSchema.extend({ videoId: VideoIdSchema });

function textForEnvelope(envelope: z.infer<typeof EnvelopeSchema>): string {
  return JSON.stringify(envelope, null, 2);
}

function success(
  runtime: YoutubeRuntime,
  data: unknown,
  channelId?: string,
  estimatedYouTubeDataQuotaUnits?: number,
): CallToolResult {
  const structuredContent = {
    ok: true,
    data,
    meta: {
      profile: runtime.profileName,
      mode: runtime.mode,
      ...(channelId ? { channelId } : {}),
      ...(estimatedYouTubeDataQuotaUnits !== undefined ? { estimatedYouTubeDataQuotaUnits } : {}),
    },
  };
  return {
    content: [{ type: "text", text: textForEnvelope(structuredContent) }],
    structuredContent,
  };
}

function failure(runtime: YoutubeRuntime, error: unknown): CallToolResult {
  const appError = asAppError(error);
  const structuredContent = {
    ok: false,
    error: { code: appError.code, message: appError.message, retriable: appError.retriable },
    meta: { profile: runtime.profileName, mode: runtime.mode },
  };
  return {
    content: [{ type: "text", text: textForEnvelope(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

async function execute(
  runtime: YoutubeRuntime,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return failure(runtime, error);
  }
}

export function createMcpServer(runtime: YoutubeRuntime): McpServer {
  const server = new McpServer({ name: "youtube-mcp", version: "0.1.0" });
  const previews = new PreviewStore();

  server.registerTool(
    "youtube_get_auth_status",
    {
      title: "Get YouTube authorization status",
      description: "Inspect the selected local profile and authorization mode without exposing credentials.",
      inputSchema: z.object({}),
      outputSchema: EnvelopeSchema,
      annotations: LOCAL_READ_ANNOTATIONS,
    },
    async () => execute(runtime, async () => success(runtime, await runtime.getAuthStatus())),
  );

  server.registerTool(
    "youtube_get_my_channel",
    {
      title: "Get my YouTube channel",
      description: "Return metadata and statistics for the channel bound to the selected profile.",
      inputSchema: z.object({}),
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async () =>
      execute(runtime, async () => {
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getMyChannel(), channelId, 1);
      }),
  );

  server.registerTool(
    "youtube_list_my_videos",
    {
      title: "List my YouTube videos",
      description: "Page through videos in the selected channel's uploads playlist.",
      inputSchema: z.object({
        pageSize: z.number().int().min(1).max(50).default(25),
        pageToken: z.string().min(1).optional(),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ pageSize, pageToken }) =>
      execute(runtime, async () => {
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.listMyVideos(pageSize, pageToken), channelId, 3);
      }),
  );

  server.registerTool(
    "youtube_get_video",
    {
      title: "Get one of my YouTube videos",
      description: "Return metadata and statistics for an owned video; non-owned videos are rejected.",
      inputSchema: z.object({ videoId: VideoIdSchema }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ videoId }) =>
      execute(runtime, async () => {
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getOwnedVideo(videoId), channelId, 1);
      }),
  );

  server.registerTool(
    "youtube_list_video_categories",
    {
      title: "List YouTube video categories",
      description: "List assignable and non-assignable categories for a region.",
      inputSchema: z.object({ regionCode: z.string().regex(/^[A-Z]{2}$/).default("US") }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ regionCode }) =>
      execute(runtime, async () => {
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.listVideoCategories(regionCode), channelId, 1);
      }),
  );

  server.registerTool(
    "youtube_get_channel_analytics",
    {
      title: "Get channel analytics",
      description: "Return fixed non-monetary YouTube Analytics metrics for the selected channel.",
      inputSchema: DateRangeSchema,
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ startDate, endDate }) =>
      execute(runtime, async () => {
        validateDateRange(startDate, endDate);
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getChannelAnalytics({ startDate, endDate }), channelId);
      }),
  );

  server.registerTool(
    "youtube_get_video_analytics",
    {
      title: "Get video analytics",
      description: "Return fixed non-monetary analytics metrics for an owned video.",
      inputSchema: VideoDateRangeSchema,
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ videoId, startDate, endDate }) =>
      execute(runtime, async () => {
        validateDateRange(startDate, endDate);
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getVideoAnalytics({ videoId, startDate, endDate }), channelId, 1);
      }),
  );

  server.registerTool(
    "youtube_get_video_traffic_sources",
    {
      title: "Get video traffic sources",
      description: "Return YouTube traffic-source types for an owned video, sorted by views.",
      inputSchema: VideoDateRangeSchema,
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ videoId, startDate, endDate }) =>
      execute(runtime, async () => {
        validateDateRange(startDate, endDate);
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getVideoTrafficSources({ videoId, startDate, endDate }), channelId, 1);
      }),
  );

  server.registerTool(
    "youtube_get_video_search_terms",
    {
      title: "Get video YouTube search terms",
      description: "Return YouTube search terms that led to an owned video.",
      inputSchema: VideoDateRangeSchema.extend({ limit: z.number().int().min(1).max(50).default(25) }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ videoId, startDate, endDate, limit }) =>
      execute(runtime, async () => {
        validateDateRange(startDate, endDate);
        const { gateway, channelId } = await runtime.getGateway();
        return success(
          runtime,
          await gateway.getVideoSearchTerms({ videoId, startDate, endDate }, limit),
          channelId,
          1,
        );
      }),
  );

  server.registerTool(
    "youtube_get_video_retention",
    {
      title: "Get video audience retention",
      description: "Return normalized audience-retention points for an owned video.",
      inputSchema: VideoDateRangeSchema,
      outputSchema: EnvelopeSchema,
      annotations: READ_ANNOTATIONS,
    },
    async ({ videoId, startDate, endDate }) =>
      execute(runtime, async () => {
        validateDateRange(startDate, endDate);
        const { gateway, channelId } = await runtime.getGateway();
        return success(runtime, await gateway.getVideoRetention({ videoId, startDate, endDate }), channelId, 1);
      }),
  );

  if (runtime.mode === "manage") {
    server.registerTool(
      "youtube_preview_video_update",
      {
        title: "Preview a YouTube video metadata update",
        description: "Create a ten-minute field-level preview without changing YouTube.",
        inputSchema: z.object({
          videoId: VideoIdSchema,
          title: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          categoryId: z.string().min(1).optional(),
        }),
        outputSchema: EnvelopeSchema,
        annotations: PREVIEW_ANNOTATIONS,
      },
      async (patch) =>
        execute(runtime, async () => {
          const { gateway, channelId } = await runtime.getGateway();
          const service = new MetadataUpdateService(gateway, previews, runtime.profileName, channelId);
          return success(runtime, await service.preview(patch), channelId, patch.categoryId ? 2 : 1);
        }),
    );

    server.registerTool(
      "youtube_apply_video_update",
      {
        title: "Apply a reviewed YouTube video metadata update",
        description: "Apply exactly one unexpired preview after rechecking ownership and remote metadata.",
        inputSchema: z.object({
          previewId: z.string().uuid(),
          previewHash: z.string().regex(/^[a-f0-9]{64}$/),
          confirmVideoId: VideoIdSchema,
        }),
        outputSchema: EnvelopeSchema,
        annotations: APPLY_ANNOTATIONS,
      },
      async ({ previewId, previewHash, confirmVideoId }) =>
        execute(runtime, async () => {
          const { gateway, channelId } = await runtime.getGateway();
          const service = new MetadataUpdateService(gateway, previews, runtime.profileName, channelId);
          return success(
            runtime,
            await service.apply(previewId, previewHash, confirmVideoId),
            channelId,
            52,
          );
        }),
    );
  }

  return server;
}

export async function startStdioServer(runtime: YoutubeRuntime): Promise<void> {
  const server = createMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
