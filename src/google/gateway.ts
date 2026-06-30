import { youtube, type youtube_v3 } from "@googleapis/youtube";
import { youtubeAnalytics, type youtubeAnalytics_v2 } from "@googleapis/youtubeanalytics";
import type { OAuth2Client } from "google-auth-library";
import { AppError } from "../errors.js";
import { validateDateRange } from "../domain/dates.js";
import type {
  AnalyticsResult,
  ChannelDetails,
  Page,
  VideoCategory,
  VideoDetails,
  WritableSnippet,
} from "../types.js";
import { normalizeGoogleError, withReadRetry } from "./retry.js";

export interface AnalyticsQuery {
  startDate: string;
  endDate: string;
}

export interface VideoAnalyticsQuery extends AnalyticsQuery {
  videoId: string;
}

export interface YouTubeGateway {
  getMyChannel(): Promise<ChannelDetails>;
  listMyVideos(pageSize: number, pageToken?: string): Promise<Page<VideoDetails>>;
  getOwnedVideo(videoId: string): Promise<VideoDetails>;
  listVideoCategories(regionCode: string): Promise<VideoCategory[]>;
  getChannelAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult>;
  getVideoAnalytics(query: VideoAnalyticsQuery): Promise<AnalyticsResult>;
  getVideoTrafficSources(query: VideoAnalyticsQuery): Promise<AnalyticsResult>;
  getVideoSearchTerms(query: VideoAnalyticsQuery, limit: number): Promise<AnalyticsResult>;
  getVideoRetention(query: VideoAnalyticsQuery): Promise<AnalyticsResult>;
  updateVideoSnippet(videoId: string, snippet: WritableSnippet): Promise<WritableSnippet>;
}

export interface GoogleClientSet {
  data: youtube_v3.Youtube;
  analytics: youtubeAnalytics_v2.Youtubeanalytics;
}

function thumbnailUrl(thumbnails: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | undefined {
  return thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? undefined;
}

function writableSnippet(snippet: youtube_v3.Schema$VideoSnippet | null | undefined): WritableSnippet {
  if (!snippet?.title || !snippet.categoryId) {
    throw new AppError("YOUTUBE_API_ERROR", "YouTube returned incomplete video metadata.");
  }
  return {
    title: snippet.title,
    description: snippet.description ?? "",
    tags: snippet.tags ?? [],
    categoryId: snippet.categoryId,
    ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
  };
}

function mapVideo(item: youtube_v3.Schema$Video): VideoDetails {
  if (!item.id || !item.snippet?.channelId) {
    throw new AppError("YOUTUBE_API_ERROR", "YouTube returned an incomplete video resource.");
  }
  return {
    id: item.id,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle ?? "",
    publishedAt: item.snippet.publishedAt ?? undefined,
    thumbnailUrl: thumbnailUrl(item.snippet.thumbnails),
    duration: item.contentDetails?.duration ?? undefined,
    liveBroadcastContent: item.snippet.liveBroadcastContent ?? undefined,
    statistics: {
      viewCount: item.statistics?.viewCount ?? undefined,
      likeCount: item.statistics?.likeCount ?? undefined,
      commentCount: item.statistics?.commentCount ?? undefined,
    },
    snippet: writableSnippet(item.snippet),
  };
}

function rowsFromAnalytics(
  response: youtubeAnalytics_v2.Schema$QueryResponse,
  startDate: string,
  endDate: string,
): AnalyticsResult {
  const headers = response.columnHeaders?.map((header) => header.name ?? "unknown") ?? [];
  const rows = (response.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])),
  );
  return {
    available: rows.length > 0,
    ...(rows.length === 0
      ? { message: "YouTube returned no rows; the date range may have no activity or data may be suppressed." }
      : {}),
    startDate,
    endDate,
    rows,
  };
}

export class GoogleYouTubeGateway implements YouTubeGateway {
  private readonly data: youtube_v3.Youtube;
  private readonly analytics: youtubeAnalytics_v2.Youtubeanalytics;

  constructor(
    auth: OAuth2Client,
    private readonly channelId: string,
    clients?: GoogleClientSet,
  ) {
    this.data = clients?.data ?? youtube({ version: "v3", auth });
    this.analytics = clients?.analytics ?? youtubeAnalytics({ version: "v2", auth });
  }

  async getMyChannel(): Promise<ChannelDetails> {
    const response = await withReadRetry(() =>
      this.data.channels.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: [this.channelId],
        maxResults: 1,
      }),
    );
    const channel = response.data.items?.[0];
    if (!channel?.id || channel.id !== this.channelId || !channel.snippet?.title) {
      throw new AppError("CHANNEL_MISMATCH", "The authorized channel does not match the selected profile.");
    }
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new AppError("YOUTUBE_API_ERROR", "The channel uploads playlist is unavailable.");
    return {
      id: channel.id,
      title: channel.snippet.title,
      description: channel.snippet.description ?? "",
      customUrl: channel.snippet.customUrl ?? undefined,
      publishedAt: channel.snippet.publishedAt ?? undefined,
      thumbnailUrl: thumbnailUrl(channel.snippet.thumbnails),
      uploadsPlaylistId,
      statistics: {
        viewCount: channel.statistics?.viewCount ?? undefined,
        subscriberCount: channel.statistics?.subscriberCount ?? undefined,
        hiddenSubscriberCount: channel.statistics?.hiddenSubscriberCount ?? undefined,
        videoCount: channel.statistics?.videoCount ?? undefined,
      },
    };
  }

  async listMyVideos(pageSize: number, pageToken?: string): Promise<Page<VideoDetails>> {
    const channel = await this.getMyChannel();
    const playlistResponse = await withReadRetry(() =>
      this.data.playlistItems.list({
        part: ["contentDetails"],
        playlistId: channel.uploadsPlaylistId,
        maxResults: pageSize,
        pageToken,
      }),
    );
    const ids = (playlistResponse.data.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      return { items: [], nextPageToken: playlistResponse.data.nextPageToken ?? undefined };
    }
    const videosResponse = await withReadRetry(() =>
      this.data.videos.list({
        part: ["snippet", "contentDetails", "statistics"],
        id: ids,
        maxResults: ids.length,
      }),
    );
    const videosById = new Map((videosResponse.data.items ?? []).map((item) => [item.id, mapVideo(item)]));
    const items = ids
      .map((id) => videosById.get(id))
      .filter((video): video is VideoDetails => Boolean(video))
      .filter((video) => video.channelId === this.channelId);
    return { items, nextPageToken: playlistResponse.data.nextPageToken ?? undefined };
  }

  async getOwnedVideo(videoId: string): Promise<VideoDetails> {
    const response = await withReadRetry(() =>
      this.data.videos.list({
        part: ["snippet", "contentDetails", "statistics"],
        id: [videoId],
        maxResults: 1,
      }),
    );
    const item = response.data.items?.[0];
    if (!item) throw new AppError("YOUTUBE_API_ERROR", "The requested video was not found.");
    const video = mapVideo(item);
    if (video.channelId !== this.channelId) {
      throw new AppError("VIDEO_NOT_OWNED", "The requested video is not owned by the selected channel.");
    }
    return video;
  }

  async listVideoCategories(regionCode: string): Promise<VideoCategory[]> {
    const response = await withReadRetry(() =>
      this.data.videoCategories.list({ part: ["snippet"], regionCode }),
    );
    return (response.data.items ?? [])
      .filter((item) => item.id && item.snippet?.title)
      .map((item) => ({
        id: item.id!,
        title: item.snippet!.title!,
        assignable: item.snippet?.assignable ?? false,
      }));
  }

  private async queryAnalytics(params: youtubeAnalytics_v2.Params$Resource$Reports$Query): Promise<AnalyticsResult> {
    const startDate = params.startDate!;
    const endDate = params.endDate!;
    validateDateRange(startDate, endDate);
    const response = await withReadRetry(() =>
      this.analytics.reports.query({
        ...params,
        ids: `channel==${this.channelId}`,
      }),
    );
    return rowsFromAnalytics(response.data, startDate, endDate);
  }

  async getChannelAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.queryAnalytics({
      ...query,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
    });
  }

  async getVideoAnalytics(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    await this.getOwnedVideo(query.videoId);
    return this.queryAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
      filters: `video==${query.videoId}`,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
    });
  }

  async getVideoTrafficSources(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    await this.getOwnedVideo(query.videoId);
    return this.queryAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
      filters: `video==${query.videoId}`,
      dimensions: "insightTrafficSourceType",
      metrics: "views,estimatedMinutesWatched,averageViewDuration",
      sort: "-views",
    });
  }

  async getVideoSearchTerms(query: VideoAnalyticsQuery, limit: number): Promise<AnalyticsResult> {
    await this.getOwnedVideo(query.videoId);
    return this.queryAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
      filters: `video==${query.videoId};insightTrafficSourceType==YT_SEARCH`,
      dimensions: "insightTrafficSourceDetail",
      metrics: "views,estimatedMinutesWatched,averageViewDuration",
      sort: "-views",
      maxResults: limit,
    });
  }

  async getVideoRetention(query: VideoAnalyticsQuery): Promise<AnalyticsResult> {
    await this.getOwnedVideo(query.videoId);
    return this.queryAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
      filters: `video==${query.videoId}`,
      dimensions: "elapsedVideoTimeRatio",
      metrics: "audienceWatchRatio,relativeRetentionPerformance",
    });
  }

  async updateVideoSnippet(videoId: string, snippet: WritableSnippet): Promise<WritableSnippet> {
    try {
      const response = await this.data.videos.update({
        part: ["snippet"],
        requestBody: {
          id: videoId,
          snippet: {
            title: snippet.title,
            description: snippet.description,
            tags: snippet.tags,
            categoryId: snippet.categoryId,
            ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
          },
        },
      });
      return writableSnippet(response.data.snippet);
    } catch (error) {
      throw normalizeGoogleError(error);
    }
  }
}
