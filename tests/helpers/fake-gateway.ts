import { AppError } from "../../src/errors.js";
import type { AnalyticsQuery, VideoAnalyticsQuery, YouTubeGateway } from "../../src/google/gateway.js";
import type {
  AnalyticsResult,
  ChannelDetails,
  Page,
  VideoCategory,
  VideoDetails,
  WritableSnippet,
} from "../../src/types.js";

export const baseSnippet: WritableSnippet = {
  title: "Original title",
  description: "Original description",
  tags: ["alpha", "beta tag"],
  categoryId: "27",
  defaultLanguage: "en",
};

export function makeVideo(snippet: WritableSnippet = baseSnippet): VideoDetails {
  return {
    id: "video-1",
    channelId: "channel-1",
    channelTitle: "Test Channel",
    publishedAt: "2026-03-23T12:00:00Z",
    duration: "PT10M",
    liveBroadcastContent: "none",
    statistics: { viewCount: "10", likeCount: "2", commentCount: "1" },
    snippet: structuredClone(snippet),
  };
}

function analytics(startDate: string, endDate: string): AnalyticsResult {
  return { available: true, startDate, endDate, rows: [{ views: 10 }] };
}

export class FakeGateway implements YouTubeGateway {
  video = makeVideo();
  categories: VideoCategory[] = [
    { id: "27", title: "Education", assignable: true },
    { id: "28", title: "Science & Technology", assignable: true },
  ];
  updateCalls: WritableSnippet[] = [];
  updateError?: AppError;
  applyBeforeError = false;

  async getMyChannel(): Promise<ChannelDetails> {
    return {
      id: "channel-1",
      title: "Test Channel",
      description: "Test",
      uploadsPlaylistId: "uploads-1",
      statistics: { viewCount: "10", subscriberCount: "2", videoCount: "1" },
    };
  }

  async listMyVideos(_pageSize: number, _pageToken?: string): Promise<Page<VideoDetails>> {
    return { items: [structuredClone(this.video)] };
  }

  async getOwnedVideo(videoId: string): Promise<VideoDetails> {
    if (videoId !== this.video.id) throw new AppError("YOUTUBE_API_ERROR", "Video not found.");
    return structuredClone(this.video);
  }

  async listVideoCategories(_regionCode: string): Promise<VideoCategory[]> {
    return structuredClone(this.categories);
  }

  async getChannelAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return analytics(query.startDate, query.endDate);
  }

  async getVideoAnalytics(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    return analytics(query.startDate, query.endDate);
  }

  async getVideoTrafficSources(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    return analytics(query.startDate, query.endDate);
  }

  async getVideoSearchTerms(query: VideoAnalyticsQuery, _limit: number): Promise<AnalyticsResult> {
    return analytics(query.startDate, query.endDate);
  }

  async getVideoRetention(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    return analytics(query.startDate, query.endDate);
  }

  async updateVideoSnippet(_videoId: string, snippet: WritableSnippet): Promise<WritableSnippet> {
    this.updateCalls.push(structuredClone(snippet));
    if (this.applyBeforeError) this.video.snippet = structuredClone(snippet);
    if (this.updateError) throw this.updateError;
    this.video.snippet = structuredClone(snippet);
    return structuredClone(snippet);
  }
}
