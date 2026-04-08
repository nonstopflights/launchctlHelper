import streamDeck from "@elgato/streamdeck";

const ARTWORK_SIZE = 144;

export async function fetchAlbumArtwork(albumId: string): Promise<string | null> {
  try {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(albumId)}&entity=album`;
    const lookupResponse = await fetch(lookupUrl);

    if (!lookupResponse.ok) {
      return null;
    }

    const data = (await lookupResponse.json()) as {
      results?: Array<{ artworkUrl100?: string }>;
    };

    const artworkTemplate = data.results?.[0]?.artworkUrl100;

    if (!artworkTemplate) {
      return null;
    }

    const artworkUrl = artworkTemplate.replace(
      /\/\d+x\d+bb\./,
      `/${ARTWORK_SIZE}x${ARTWORK_SIZE}bb.`
    );

    const imageResponse = await fetch(artworkUrl);

    if (!imageResponse.ok) {
      return null;
    }

    const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streamDeck.logger.warn(`Failed to fetch album artwork: ${message}`);
    return null;
  }
}
