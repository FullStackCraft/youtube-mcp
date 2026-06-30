import { OAuth2Client } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GoogleYouTubeGateway } from "../src/google/gateway.js";

function clients() {
  const videosList = vi.fn(async ({ id }: any) => ({
    data: {
      items: id.map((videoId: string) => ({
        id: videoId,
        snippet: {
          channelId: "channel-1",
          channelTitle: "Channel",
          title: `Title ${videoId}`,
          description: "Description",
          tags: ["tag"],
          categoryId: "27",
          defaultLanguage: "en",
          liveBroadcastContent: "none",
        },
        contentDetails: { duration: "PT1M" },
        statistics: { viewCount: "1" },
      })),
    },
  }));
  const update = vi.fn(async ({ requestBody }: any) => ({ data: requestBody }));
  const data = {
    channels: {
      list: vi.fn(async () => ({
        data: {
          items: [
            {
              id: "channel-1",
              snippet: { title: "Channel", description: "Description" },
              contentDetails: { relatedPlaylists: { uploads: "uploads" } },
              statistics: { viewCount: "2", videoCount: "2" },
            },
          ],
        },
      })),
    },
    playlistItems: {
      list: vi.fn(async () => ({
        data: {
          items: [
            { contentDetails: { videoId: "second" } },
            { contentDetails: { videoId: "first" } },
          ],
          nextPageToken: "next",
        },
      })),
    },
    videos: { list: videosList, update },
    videoCategories: {
      list: vi.fn(async () => ({
        data: { items: [{ id: "27", snippet: { title: "Education", assignable: true } }] },
      })),
    },
  };
  const query = vi.fn(async () => ({
    data: {
      columnHeaders: [
        { name: "insightTrafficSourceDetail", columnType: "DIMENSION" },
        { name: "views", columnType: "METRIC", dataType: "INTEGER" },
      ],
      rows: [["gamma exposure", 4]],
    },
  }));
  const analytics = { reports: { query } };
  return { data, analytics, videosList, update, query };
}

function gateway(mock: ReturnType<typeof clients>) {
  return new GoogleYouTubeGateway(new OAuth2Client(), "channel-1", mock as any);
}

describe("Google YouTube gateway contracts", () => {
  it("uses the uploads playlist and preserves playlist order", async () => {
    const mock = clients();
    const result = await gateway(mock).listMyVideos(2);
    expect(result.items.map((video) => video.id)).toEqual(["second", "first"]);
    expect(result.nextPageToken).toBe("next");
    expect(mock.data.playlistItems.list).toHaveBeenCalledWith(
      expect.objectContaining({ playlistId: "uploads", maxResults: 2 }),
    );
  });

  it("rejects a video from another channel", async () => {
    const mock = clients();
    mock.videosList.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: "foreign",
            snippet: { channelId: "other", title: "Foreign", description: "", categoryId: "27" },
          },
        ],
      },
    } as any);
    await expect(gateway(mock).getOwnedVideo("foreign")).rejects.toMatchObject({ code: "VIDEO_NOT_OWNED" });
  });

  it("uses the fixed YouTube Search analytics query", async () => {
    const mock = clients();
    const result = await gateway(mock).getVideoSearchTerms(
      { videoId: "video-1", startDate: "2026-03-01", endDate: "2026-03-31" },
      25,
    );
    expect(mock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: "channel==channel-1",
        filters: "video==video-1;insightTrafficSourceType==YT_SEARCH",
        dimensions: "insightTrafficSourceDetail",
        maxResults: 25,
        sort: "-views",
      }),
    );
    expect(result.rows).toEqual([{ insightTrafficSourceDetail: "gamma exposure", views: 4 }]);
  });

  it("uses fixed retention dimensions and metrics", async () => {
    const mock = clients();
    await gateway(mock).getVideoRetention({
      videoId: "video-1",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(mock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: "elapsedVideoTimeRatio",
        metrics: "audienceWatchRatio,relativeRetentionPerformance",
      }),
    );
  });

  it("sends only the writable snippet fields on update", async () => {
    const mock = clients();
    await gateway(mock).updateVideoSnippet("video-1", {
      title: "New",
      description: "Description",
      tags: ["tag"],
      categoryId: "27",
      defaultLanguage: "en",
    });
    expect(mock.update).toHaveBeenCalledWith({
      part: ["snippet"],
      requestBody: {
        id: "video-1",
        snippet: {
          title: "New",
          description: "Description",
          tags: ["tag"],
          categoryId: "27",
          defaultLanguage: "en",
        },
      },
    });
  });

  it("returns a successful unavailable result when analytics has no rows", async () => {
    const mock = clients();
    mock.query.mockResolvedValueOnce({ data: { columnHeaders: [{ name: "views" }], rows: [] } } as any);
    const result = await gateway(mock).getChannelAnalytics({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(result).toMatchObject({ available: false, rows: [] });
  });
});
