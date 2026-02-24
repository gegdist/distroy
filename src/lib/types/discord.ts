export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  global_name: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
  recipients?: DiscordUser[];
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  type: number;
}

export interface SearchResponse {
  total_results: number;
  messages: DiscordMessage[][];
  analytics_id?: string;
}

export interface RateLimitHeaders {
  remaining: number | null;
  resetAfter: number | null;
  bucket: string | null;
  retryAfter: number | null;
}
