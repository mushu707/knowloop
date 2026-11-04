import { z } from 'zod';
import { Id, Iso, Semver, Sha256Hex } from './common';
import { KpNode } from './kp';
import { Question } from './question';

export const BankPack = z.object({
  schemaVersion: z.number().int().positive(),
  id: Id,
  name: z.string().min(1).max(80),
  version: Semver,
  author: z.string().max(80).optional(),
  license: z.string().max(40).default('AGPL-3.0'),
  description: z.string().max(500).optional(),
  createdAt: Iso,
  kpTree: z.array(KpNode),
  questions: z.array(Question).min(1),
  checksum: Sha256Hex.optional(),
});
export type BankPack = z.infer<typeof BankPack>;
