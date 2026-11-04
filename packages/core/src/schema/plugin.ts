import { z } from 'zod';
import { Id, Semver } from './common';

/**
 * v0.2 的插槽。v0.1 不实现运行时，只把形状写进契约，避免后续改 schema。
 * 安全前提：插件只在 Web Worker 内运行，通过 RPC 访问受限 API。
 */
export const PluginManifest = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  version: Semver,
  apiVersion: z.literal('0.1'),
  inject: z.array(z.string()).default([]),
  extends: z
    .object({
      questionFields: z.record(z.string(), z.unknown()).optional(),
      errorTags: z.array(z.object({ id: Id, label: z.string() })).default([]),
      kpTreeUrl: z.string().optional(),
    })
    .default({ errorTags: [] }),
  graders: z
    .array(
      z.object({
        type: z.string(),
        entry: z.string(),
      }),
    )
    .default([]),
});
export type PluginManifest = z.infer<typeof PluginManifest>;
