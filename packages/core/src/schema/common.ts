import { z } from 'zod';

export const SCHEMA_VERSION = 1;

/** UTC ISO8601，展示层再转本地时区 */
export const Iso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, '必须是 UTC ISO8601，如 2026-11-03T08:00:00.000Z');

export const Id = z.string().min(1).max(64);
export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
export const Semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i);
