import streamDeck from "@elgato/streamdeck";

import { AppleMusicAlbumAction } from "./actions/apple-music-album";

streamDeck.actions.registerAction(new AppleMusicAlbumAction());

streamDeck.connect();
