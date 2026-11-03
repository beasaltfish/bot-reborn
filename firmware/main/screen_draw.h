// Decode the newest JPEG frame and put it on the panel (pet screen spec §6).
// One task, below the audio tasks in priority.

#pragma once

/* Needs the screen started and screen_link_start called. Returns at once. */
void screen_draw_start(void);
