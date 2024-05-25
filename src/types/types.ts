export type AndroidConfigFS =
  | {
      encoding: BufferEncoding;
      flag?: string | undefined;
    }
  | BufferEncoding;

export interface AndroidConfig {
  buildVersion: string | null;
  marketingVersion: string | null;
}

export type IOSConfig = {
  CURRENT_PROJECT_VERSION: string | null;
  MARKETING_VERSION: string | null;
};
