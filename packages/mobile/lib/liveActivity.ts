/**
 * Non-iOS Live Activity boundary. Metro resolves liveActivity.ios.ts on iOS;
 * Android and web keep these calls as safe no-ops without loading SwiftUI-only
 * widget code into their bundles. On SDK 58 Android, importing the expo-widgets
 * factories throws at launch, so nothing here may import them.
 */
export interface LiveActivityContent {
  title: string;
  body: string;
  endsAt?: string | null;
}

export async function startOrUpdateLiveActivity(_content: LiveActivityContent): Promise<void> {}

export async function endLiveActivity(): Promise<void> {}

export async function updateWidgetSnapshot(_content: LiveActivityContent): Promise<void> {}

export async function clearWidgetSnapshot(): Promise<void> {}
