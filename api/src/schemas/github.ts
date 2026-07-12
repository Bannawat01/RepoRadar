import { z } from 'zod';

/**
 * Minimal zod schemas for the GitHub events RepoRadar cares about.
 * We only declare the fields we actually consume — GitHub payloads are huge,
 * and `.passthrough()` keeps unknown fields without failing validation.
 */

const UserSchema = z
  .object({
    login: z.string(),
    html_url: z.string().url(),
    avatar_url: z.string().url().optional(),
  })
  .passthrough();

const RepoSchema = z
  .object({
    full_name: z.string(),
    html_url: z.string().url(),
  })
  .passthrough();

export const PushEventSchema = z
  .object({
    ref: z.string(),
    before: z.string().optional(),
    after: z.string().optional(),
    compare: z.string().url(),
    created: z.boolean().optional(), // branch/tag was created
    deleted: z.boolean().optional(), // branch/tag was deleted
    forced: z.boolean().optional(), // force push
    repository: RepoSchema,
    sender: UserSchema,
    pusher: z.object({ name: z.string() }).passthrough().optional(),
    commits: z
      .array(
        z
          .object({
            id: z.string(),
            message: z.string(),
            url: z.string().url(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export const PullRequestEventSchema = z
  .object({
    action: z.string(),
    number: z.number(),
    repository: RepoSchema,
    sender: UserSchema,
    pull_request: z
      .object({
        title: z.string(),
        html_url: z.string().url(),
        body: z.string().nullable().optional(),
        merged: z.boolean().optional(),
        draft: z.boolean().optional(),
        additions: z.number().optional(),
        deletions: z.number().optional(),
        changed_files: z.number().optional(),
        head: z.object({ ref: z.string() }).passthrough(),
        base: z.object({ ref: z.string() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export const IssuesEventSchema = z
  .object({
    action: z.string(),
    repository: RepoSchema,
    sender: UserSchema,
    label: z.object({ name: z.string() }).passthrough().optional(),
    issue: z
      .object({
        number: z.number(),
        title: z.string(),
        html_url: z.string().url(),
        body: z.string().nullable().optional(),
        state: z.string().optional(),
        labels: z
          .array(z.object({ name: z.string() }).passthrough())
          .default([]),
      })
      .passthrough(),
  })
  .passthrough();

export type PushEvent = z.infer<typeof PushEventSchema>;
export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;
export type IssuesEvent = z.infer<typeof IssuesEventSchema>;
