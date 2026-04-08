const MAX_TITLE_LENGTH = 24;
const MAX_LINE_LENGTH = 10;

export type ParsedAppleMusicAlbum = {
  albumId?: string;
  albumLabel: string;
  normalizedUrl: string;
  storefront?: string;
};

export function parseAppleMusicAlbumUrl(input: string): ParsedAppleMusicAlbum | null {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "music.apple.com") {
    return null;
  }

  if (url.searchParams.has("i")) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const albumIndex = segments.indexOf("album");

  if (albumIndex === -1 || segments.length < albumIndex + 2) {
    return null;
  }

  const slug = segments[albumIndex + 1];
  const albumId = segments.at(-1)?.replace(/^id/i, "");

  if (!slug) {
    return null;
  }

  url.hash = "";

  return {
    albumId,
    albumLabel: humanizeSlug(slug),
    normalizedUrl: url.toString(),
    storefront: segments[0]
  };
}

export function formatKeyTitle(label: string): string {
  const collapsed = label.replace(/\s+/g, " ").trim();

  if (!collapsed) {
    return "Assign\nAlbum";
  }

  const trimmed = collapsed.slice(0, MAX_TITLE_LENGTH).trim();

  if (trimmed.length <= MAX_LINE_LENGTH) {
    return trimmed;
  }

  const midpoint = Math.min(trimmed.length - 1, MAX_LINE_LENGTH);
  const breakIndex = trimmed.lastIndexOf(" ", midpoint);
  const safeBreak = breakIndex > 0 ? breakIndex : MAX_LINE_LENGTH;
  const lineOne = trimmed.slice(0, safeBreak).trim();
  const lineTwo = trimmed.slice(safeBreak).trim();

  if (!lineTwo) {
    return lineOne;
  }

  return `${lineOne}\n${lineTwo.slice(0, MAX_LINE_LENGTH)}`;
}

function humanizeSlug(slug: string): string {
  const decoded = decodeURIComponent(slug);

  return decoded
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}
