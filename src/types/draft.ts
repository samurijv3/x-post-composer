/**
 * A draft is always an array of posts so threads can be added later without
 * reshaping every caller (CLAUDE.md §8). In v1 the array length is always 1.
 */
export interface PostDraft {
  /** The candidate post text. */
  text: string;
  /** Character count as measured by twitter-text — populated in Chunk 3. */
  characterCount?: number;
}

export interface Draft {
  /** Ordered posts. v1 always has length 1; thread mode arrives later. */
  posts: PostDraft[];
}
