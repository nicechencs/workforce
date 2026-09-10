import { bannerForConnection, type BannerModel, type ConnectionSnapshot } from "@workforce/ui";

export function connectionBanner(snapshot: ConnectionSnapshot): BannerModel | null {
  return bannerForConnection(snapshot);
}

export function bannerToneClass(banner: BannerModel): string {
  return `wf-banner wf-banner-${banner.tone}`;
}
