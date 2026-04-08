import { execFile } from "node:child_process";
import streamDeck, {
  SingletonAction,
  action,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import {
  formatKeyTitle,
  parseAppleMusicAlbumUrl,
  type ParsedAppleMusicAlbum
} from "../lib/apple-music";
import { fetchAlbumArtwork } from "../lib/artwork";
import { ACTION_UUID } from "../lib/constants";
import { normalizeActionSettings, type AppleMusicAlbumSettings } from "../lib/models";

@action({ UUID: ACTION_UUID })
export class AppleMusicAlbumAction extends SingletonAction<AppleMusicAlbumSettings> {
  override async onKeyDown(ev: KeyDownEvent<AppleMusicAlbumSettings>): Promise<void> {
    streamDeck.logger.info(`onKeyDown fired for action ${ev.action.id}`);
    const settings = normalizeActionSettings(ev.payload.settings);
    streamDeck.logger.info(`settings.albumUrl = ${settings.albumUrl ?? "(none)"}`);

    const parsedAlbum = settings.albumUrl ? parseAppleMusicAlbumUrl(settings.albumUrl) : null;

    if (!parsedAlbum) {
      streamDeck.logger.warn(`No valid Apple Music URL configured for action ${ev.action.id}.`);
      await ev.action.showAlert();
      return;
    }

    streamDeck.logger.info(`Parsed album: label=${parsedAlbum.albumLabel}, url=${parsedAlbum.normalizedUrl}`);
    void openAndPlay(ev.action, parsedAlbum);
  }

  override async onWillAppear(ev: WillAppearEvent<AppleMusicAlbumSettings>): Promise<void> {
    const settings = normalizeActionSettings(ev.payload.settings);

    if (ev.action.isKey()) {
      await this.applyKeyAppearance(ev.action, settings);
    }
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<JsonValue, AppleMusicAlbumSettings>
  ): Promise<void> {
    const payload = ev.payload as Record<string, unknown> | null;

    if (!payload || !ev.action.isKey()) {
      return;
    }

    const action = ev.action;

    if (payload.type === "toggle-show-title") {
      const currentSettings = normalizeActionSettings(await action.getSettings());
      currentSettings.showTitle = payload.showTitle !== false;
      await action.setSettings(currentSettings);
      await this.applyKeyAppearance(action, currentSettings);
      return;
    }

    if (payload.type !== "set-album-url") {
      return;
    }
    const rawUrl = typeof payload.url === "string" ? payload.url : "";
    const parsedAlbum = parseAppleMusicAlbumUrl(rawUrl);

    if (!parsedAlbum) {
      await streamDeck.ui.sendToPropertyInspector({
        type: "set-album-result",
        status: "error",
        message: "Invalid Apple Music album URL."
      });
      await action.showAlert();
      return;
    }

    const currentSettings = normalizeActionSettings(await action.getSettings());
    const nextSettings: AppleMusicAlbumSettings = {
      albumLabel: parsedAlbum.albumLabel,
      albumUrl: parsedAlbum.normalizedUrl,
      showTitle: currentSettings.showTitle,
      updatedAt: new Date().toISOString()
    };

    // Fetch artwork in the background — save settings immediately so the user gets quick feedback
    const artworkPromise = parsedAlbum.albumId
      ? fetchAlbumArtwork(parsedAlbum.albumId)
      : Promise.resolve(null);

    await action.setSettings(nextSettings);
    await this.applyKeyAppearance(action, nextSettings);
    await action.showOk();
    await streamDeck.ui.sendToPropertyInspector({
      type: "set-album-result",
      status: "success",
      message: `Assigned: ${parsedAlbum.albumLabel}`
    });

    // Apply artwork once fetched
    const artworkBase64 = await artworkPromise;

    if (artworkBase64) {
      nextSettings.artworkBase64 = artworkBase64;
      await action.setSettings(nextSettings);
      await action.setImage(artworkBase64);
    }
  }

  private async applyKeyAppearance(
    action: { setTitle(title: string): Promise<void>; setImage(image?: string): Promise<void> },
    settings: AppleMusicAlbumSettings
  ): Promise<void> {
    if (settings.showTitle === true && settings.albumLabel) {
      await action.setTitle(formatKeyTitle(settings.albumLabel));
    } else if (!settings.albumUrl) {
      await action.setTitle("Assign\nAlbum");
    } else {
      await action.setTitle("");
    }

    if (settings.artworkBase64) {
      await action.setImage(settings.artworkBase64);
    }
  }
}

type KeyAction = {
  showAlert(): Promise<void>;
};

type AnchorOffset = {
  x: number;
  y: number;
};

const MUSIC_OPEN_DELAY_MS = 4000;
const CLICK_RETRY_DELAY_MS = 900;
const PLAY_BUTTON_OFFSET: AnchorOffset = { x: 631, y: 434 };
const FIRST_TRACK_OFFSET: AnchorOffset = { x: 260, y: 570 };
const PLAY_BUTTON_ATTEMPTS = 4;
const FIRST_TRACK_ATTEMPTS = 3;

async function openAndPlay(action: KeyAction, album: ParsedAppleMusicAlbum): Promise<void> {
  streamDeck.logger.info(`openAndPlay called with url=${album.normalizedUrl}`);

  await stopMusicPlayback();

  const openedInMusic = await openAlbumInMusic(album.normalizedUrl);

  if (!openedInMusic) {
    streamDeck.logger.warn(`Unable to open album in Music.app`);
    await action.showAlert();
    return;
  }

  await wait(MUSIC_OPEN_DELAY_MS);

  for (let attempt = 1; attempt <= PLAY_BUTTON_ATTEMPTS; attempt++) {
    const result = await clickFromCloseButtonAnchor(PLAY_BUTTON_OFFSET, 1);
    streamDeck.logger.info(`Play-button attempt ${attempt}/${PLAY_BUTTON_ATTEMPTS}: ${result}`);

    if (result.includes("|playing")) {
      return;
    }

    await wait(CLICK_RETRY_DELAY_MS);
  }

  for (let attempt = 1; attempt <= FIRST_TRACK_ATTEMPTS; attempt++) {
    const result = await clickFromCloseButtonAnchor(FIRST_TRACK_OFFSET, 2);
    streamDeck.logger.info(`First-track attempt ${attempt}/${FIRST_TRACK_ATTEMPTS}: ${result}`);

    if (result.includes("|playing")) {
      return;
    }

    await wait(CLICK_RETRY_DELAY_MS);
  }

  await action.showAlert();
}

async function openAlbumInMusic(albumUrl: string): Promise<boolean> {
  try {
    const appUrl = buildMusicOpenUrl(albumUrl);
    await streamDeck.system.openUrl(appUrl);
    streamDeck.logger.info(`openUrl resolved for ${appUrl}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streamDeck.logger.error(`openUrl failed: ${message}`);
    return false;
  }
}

async function stopMusicPlayback(): Promise<void> {
  const stopLines = [
    'tell application "Music"',
    "activate",
    "try",
    "stop",
    "end try",
    "end tell"
  ];

  try {
    await runAppleScript(stopLines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streamDeck.logger.warn(`Unable to stop Music playback before opening album: ${message}`);
  }
}

async function clickFromCloseButtonAnchor(offset: AnchorOffset, clickCount: number): Promise<string> {
  const clickLines = [
    'tell application "System Events"',
    'tell process "Music"',
    "set frontmost to true",
    'set closeButton to first button of window 1 whose description is "close button"',
    "set anchorPosition to position of closeButton",
    `set targetX to (item 1 of anchorPosition) + ${offset.x}`,
    `set targetY to (item 2 of anchorPosition) + ${offset.y}`,
    `repeat with clickIndex from 1 to ${clickCount}`,
    "click at {targetX, targetY}",
    "delay 0.15",
    "end repeat",
    "end tell",
    "end tell",
    "delay 0.5",
    'tell application "Music"',
    'return (targetX as text) & "," & (targetY as text) & "|" & (player state as text)',
    "end tell"
  ];

  try {
    const { stdout } = await runAppleScript(clickLines);
    return stdout || "error:no-output";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `error:osascript:${message}`;
  }
}

async function runAppleScript(lines: string[]): Promise<{ stderr: string; stdout: string }> {
  const args = lines.flatMap((line) => ["-e", line]);

  return await new Promise((resolve, reject) => {
    execFile("osascript", args, (error, stdout, stderr) => {
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();

      if (error) {
        reject(new Error(trimmedStderr || trimmedStdout || error.message));
        return;
      }

      resolve({
        stderr: trimmedStderr,
        stdout: trimmedStdout
      });
    });
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildMusicOpenUrl(albumUrl: string): string {
  const url = new URL(albumUrl);

  if (!url.searchParams.has("app")) {
    url.searchParams.set("app", "music");
  }

  return url.toString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
