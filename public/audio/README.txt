Optional recorded music.

Ocean Explorer makes all of its sound itself (day and night music, the depth ambience, bubbles, effects), so
this folder can stay empty, and by default nothing is requested from it.

To use your own recordings instead (original or properly licensed only), put looping files here, for example

    music-day.mp3      the day soundtrack
    music-night.mp3    the night soundtrack

(MP3 or AAC/M4A work in every browser; about 96-128 kbps is plenty for ambient music), then list them in
src/audio/files.js. A recording replaces the generated piece of its mode and crossfades with the other when
day and night switch. If a file is missing or cannot be decoded, the browser console says exactly why and the
generated music keeps playing.
