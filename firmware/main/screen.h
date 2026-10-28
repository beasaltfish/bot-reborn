// The pet's screen (pet screen spec §6). Its own task, below the audio tasks
// in priority: a slow panel must never starve the I2S rings.

#pragma once

/* Bring the panel up and run the colour test. Returns at once; the screen
   comes alive on its own task, so a missing or broken panel costs one line in
   the log and nothing else. */
void screen_start(void);
