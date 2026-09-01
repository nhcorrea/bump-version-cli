import { AndroidConfig, IOSConfig } from "../types/types";

export function formatAndroidStatus(
  androidConfig: AndroidConfig,
  isFinish = false
): string {
  const headerText = isFinish
    ? "Android version updated successfully!"
    : "Current Android version:";

  return [
    headerText,
    `Version Name (Marketing Version): ${androidConfig.marketingVersion}`,
    `Version Code (Build): ${androidConfig.buildVersion}`,
  ].join("\n");
}

export function formatIOSStatus(
  iosConfig: IOSConfig,
  isFinish = false
): string {
  const headerText = isFinish
    ? "iOS version updated successfully!"
    : "Current iOS app version:";

  return [
    headerText,
    `Current Project Version (Build): ${iosConfig.CURRENT_PROJECT_VERSION}`,
    `Marketing Version (Marketing Version): ${iosConfig.MARKETING_VERSION}`,
  ].join("\n");
}
