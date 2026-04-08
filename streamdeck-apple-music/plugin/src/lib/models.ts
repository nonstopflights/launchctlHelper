import type { JsonObject } from "@elgato/utils";

export type AppleMusicAlbumSettings = JsonObject & {
  albumLabel?: string;
  albumUrl?: string;
  artworkBase64?: string;
  showTitle?: boolean;
  updatedAt?: string;
};

export function normalizeActionSettings(
  value: Partial<AppleMusicAlbumSettings> | null | undefined
): AppleMusicAlbumSettings {
  return {
    albumLabel: typeof value?.albumLabel === "string" ? value.albumLabel : undefined,
    albumUrl: typeof value?.albumUrl === "string" ? value.albumUrl : undefined,
    artworkBase64: typeof value?.artworkBase64 === "string" ? value.artworkBase64 : undefined,
    showTitle: value?.showTitle === true,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : undefined
  };
}
