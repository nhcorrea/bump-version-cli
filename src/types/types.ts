export type AndroidConfigFS =
  | {
      encoding: BufferEncoding;
      flag?: string | undefined;
    }
  | BufferEncoding;

export interface AndroidConfig {
  buildVersion: string;
  marketingVersion: string;
}

export type IOSConfig = {
  CURRENT_PROJECT_VERSION: string;
  MARKETING_VERSION: string;
};
