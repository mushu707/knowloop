import { z } from 'zod';
import { Id } from './common';

export const KpNode = z.object({
  id: Id,
  bankId: Id,
  parentId: Id.nullable(),
  name: z.string().min(1).max(60),
  order: z.number().int().nonnegative().default(0),
  aliases: z.array(z.string().min(1)).max(8).default([]),
});

export type KpNode = z.infer<typeof KpNode>;
