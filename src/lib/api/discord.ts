import type {
  DiscordUser,
  DiscordGuild,
  DiscordChannel,
  DiscordMessage,
  SearchResponse,
} from '@/lib/types/discord';
import { RateLimiter } from '@/lib/api/rate-limiter';

const BASE = 'https://discord.com/api/v9';

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
  async searchGuild(
    guildId: string,
    authorId: string,
    offset = 0,
  ): Promise<SearchResponse> {
    const qs = new URLSearchParams({
      author_id: authorId,
      include_nsfw: 'true',
      offset: String(offset),
    });
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
  async searchChannel(
    channelId: string,
    authorId: string,
    offset = 0,
  ): Promise<SearchResponse> {
    const qs = new URLSearchParams({
      author_id: authorId,
      offset: String(offset),
    });
    const { data } = await this.request<SearchResponse>(
      'GET',
      `/channels/${channelId}/messages/search?${qs}`,
      `search_channel_${channelId}`,
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
