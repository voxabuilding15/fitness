import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const SOURCES = {
  tap: require('../../assets/sounds/tap.wav'),
  success: require('../../assets/sounds/success.wav'),
};
export type SoundName = keyof typeof SOURCES;

let enabled = true;
const players: Partial<Record<SoundName, AudioPlayer>> = {};

export const setSoundEnabled = (value: boolean) => {
  enabled = value;
};

/** Plays a short UI sound effect; a silent no-op when the Sound setting is off or audio is unavailable. */
export function playSound(name: SoundName = 'tap') {
  if (!enabled) return;
  try {
    const player = (players[name] ??= createAudioPlayer(SOURCES[name]));
    player.seekTo(0);
    player.play();
  } catch {
    // audio is optional; never break the UI because of it
  }
}
