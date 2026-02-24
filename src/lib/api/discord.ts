import type {
  DiscordUser,
  DiscordGuild,
  DiscordChannel,
  DiscordMessage,
  SearchResponse,
} from '@/lib/types/discord';
import { RateLimiter } from '@/lib/api/rate-limiter';

const BASE = 'https://discord.com/api/v9';

type SearchSortBy = 'relevance' | 'timestamp';
type SearchSortOrder = 'asc' | 'desc';

export interface MessageSearchOptions {
  offset?: number;
  maxId?: string;
  minId?: string;
  sortBy?: SearchSortBy;
  sortOrder?: SearchSortOrder;
  includeNsfw?: boolean;
}

export interface ChannelMessagePageOptions {
  before?: string;
  after?: string;
  around?: string;
  limit?: number; // 1..100
}

export class DiscordClient {
  private token = '';
  private limiter = new RateLimiter();

  setToken(token: string): void {
    this.token = token;
  }

  hasToken(): boolean {
    return this.token.length > 0;
  }

  private async request<T>(
    method: string,
    path: string,
    bucket: string,
  ): Promise<{ data: T; status: number }> {
    const token = this.token;
    const res = await this.limiter.enqueue(bucket, () =>
      fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
      }),
    );

    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => '');
      throw new ApiError(res.status, `${method} ${path}: ${res.status} — ${body}`);
    }

    if (res.status === 204) {
      return { data: undefined as unknown as T, status: 204 };
    }

    const data = (await res.json()) as T;
    return { data, status: res.status };
  }

  async getMe(): Promise<DiscordUser> {
    const { data } = await this.request<DiscordUser>('GET', '/users/@me', 'users_me');
    return data;
  }

  async getGuilds(): Promise<DiscordGuild[]> {
    const { data } = await this.request<DiscordGuild[]>('GET', '/users/@me/guilds', 'guilds');
    return data;
  }

  async getDMChannels(): Promise<DiscordChannel[]> {
    const { data } = await this.request<DiscordChannel[]>('GET', '/users/@me/channels', 'channels');
    return data;
  }

  /**
   * Search messages authored by `authorId` in a guild.
   * Returns one page at a time (up to 25 messages).
   */
  async searchGuild(guildId: string, authorId: string, offset?: number): Promise<SearchResponse>;
  async searchGuild(
    guildId: string,
    authorId: string,
    options?: MessageSearchOptions,
  ): Promise<SearchResponse>;
  async searchGuild(
    guildId: string,
    authorId: string,
    offsetOrOptions: number | MessageSearchOptions = 0,
  ): Promise<SearchResponse> {
    const options: MessageSearchOptions =
      typeof offsetOrOptions === 'number' ? { offset: offsetOrOptions } : (offsetOrOptions ?? {});

    const qs = new URLSearchParams({
      author_id: authorId,
      include_nsfw: String(options.includeNsfw ?? true),
      offset: String(options.offset ?? 0),
    });
    if (options.maxId) qs.set('max_id', options.maxId);
    if (options.minId) qs.set('min_id', options.minId);
    if (options.sortBy) qs.set('sort_by', options.sortBy);
    if (options.sortOrder) qs.set('sort_order', options.sortOrder);
    const { data } = await this.request<SearchResponse>(
      'GET',
      `/guilds/${guildId}/messages/search?${qs}`,
      `search_guild_${guildId}`,
    );
    return data;
  }

  /**
   * Search messages authored by `authorId` in a DM / group DM channel.
   */
  async searchChannel(channelId: string, authorId: string, offset?: number): Promise<SearchResponse>;
  async searchChannel(
    channelId: string,
    authorId: string,
    options?: MessageSearchOptions,
  ): Promise<SearchResponse>;
  async searchChannel(
    channelId: string,
    authorId: string,
    offsetOrOptions: number | MessageSearchOptions = 0,
  ): Promise<SearchResponse> {
    const options: MessageSearchOptions =
      typeof offsetOrOptions === 'number' ? { offset: offsetOrOptions } : (offsetOrOptions ?? {});

    const qs = new URLSearchParams({
      author_id: authorId,
      offset: String(options.offset ?? 0),
    });
    if (options.maxId) qs.set('max_id', options.maxId);
    if (options.minId) qs.set('min_id', options.minId);
    if (options.sortBy) qs.set('sort_by', options.sortBy);
    if (options.sortOrder) qs.set('sort_order', options.sortOrder);
    const { data } = await this.request<SearchResponse>(
      'GET',
      `/channels/${channelId}/messages/search?${qs}`,
      `search_channel_${channelId}`,
    );
    return data;
  }

  /**
   * Deterministic message history paging in a channel (DM, group DM, or guild channel).
   * Prefer this over search when Discord's index stalls.
   */
  async getChannelMessages(
    channelId: string,
    options: ChannelMessagePageOptions = {},
  ): Promise<DiscordMessage[]> {
    const qs = new URLSearchParams();
    if (options.before) qs.set('before', options.before);
    if (options.after) qs.set('after', options.after);
    if (options.around) qs.set('around', options.around);
    if (options.limit) qs.set('limit', String(options.limit));

    const suffix = qs.toString();
    const { data } = await this.request<DiscordMessage[]>(
      'GET',
      `/channels/${channelId}/messages${suffix ? `?${suffix}` : ''}`,
      `history_${channelId}`,
    );
    return data;
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
  ): Promise<{ deleted: boolean; reason?: 'permission' | 'notFound' }> {
    try {
      await this.request<void>(
        'DELETE',
        `/channels/${channelId}/messages/${messageId}`,
        `delete_${channelId}`,
      );
      return { deleted: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { deleted: false, reason: 'notFound' };
      }
      if (err instanceof ApiError && err.status === 403) {
        return { deleted: false, reason: 'permission' };
      }
      throw err;
    }
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
