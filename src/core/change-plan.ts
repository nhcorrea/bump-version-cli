import { createHash } from "crypto";

export type ChangePlatform = "android" | "ios";

export interface ChangeMatchCount {
  build: number;
  marketing: number;
  total: number;
}

export interface ChangePlan<TConfig> {
  platform: ChangePlatform;
  path: string;
  before: TConfig;
  after: TConfig;
  beforeContent: string;
  afterContent: string;
  beforeHash: string;
  afterHash: string;
  matches: ChangeMatchCount;
  changed: boolean;
}

export interface AppliedChange<TConfig> {
  plan: ChangePlan<TConfig>;
  config: TConfig;
  changed: boolean;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildChangePlan<TConfig>(options: {
  platform: ChangePlatform;
  path: string;
  before: TConfig;
  after: TConfig;
  beforeContent: string;
  afterContent: string;
  buildMatches: number;
  marketingMatches: number;
}): ChangePlan<TConfig> {
  const beforeHash = hashContent(options.beforeContent);
  const afterHash = hashContent(options.afterContent);

  return {
    platform: options.platform,
    path: options.path,
    before: options.before,
    after: options.after,
    beforeContent: options.beforeContent,
    afterContent: options.afterContent,
    beforeHash,
    afterHash,
    matches: {
      build: options.buildMatches,
      marketing: options.marketingMatches,
      total: options.buildMatches + options.marketingMatches,
    },
    changed: beforeHash !== afterHash,
  };
}
