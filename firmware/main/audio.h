// The microphone and the speaker, on one I2S bus. The microphone streams to
// the brain all the time, speaker or not: the brain keeps the echo out with
// bargeIn off (firmware spec §5), and a body that went deaf while talking
// would not hear the emergency word.

#pragma once
#include <stddef.h>
#include <stdint.h>

/* I2S full duplex and its two tasks. A bus that will not start is logged and
   left off: the link and the motors run without it. */
void audio_start(void);
void audio_play_bytes(const uint8_t *bytes, size_t n);
void audio_hush(void);
