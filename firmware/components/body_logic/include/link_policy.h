// When to knock again, and when the brain has gone quiet. As
// phone/body-link.js, a drop is retried with backoff and a second with no
// frame of any kind means the brain is gone. A reject is final, except busy:
// a car has nobody to tap refresh, and busy is usually the brain still holding
// the connection a Wi-Fi blip broke, which it lets go of within a second or so.

#pragma once
#include <stdbool.h>
#include <stdint.h>

#define LINK_WATCHDOG_MS 1000
#define LINK_HEARTBEAT_MS 300
/* How long a run of busy rejects is retried before the body gives up. */
#define LINK_BUSY_GIVE_UP_MS 15000

typedef struct { int attempt; bool finished; bool busy; uint32_t busy_since_ms; } retry_t;
uint32_t retry_next_ms(retry_t *r);   /* 500, 1000, 2000, 5000, 5000, … */
void retry_welcomed(retry_t *r);      /* back to 500, and a later busy starts a new run */
/* finished, unless reason is "busy" and the run of busy is under
   LINK_BUSY_GIVE_UP_MS old. */
void retry_rejected(retry_t *r, const char *reason, uint32_t now_ms);

typedef struct { uint32_t last_heard_ms; bool live; } dog_t;
void dog_start(dog_t *d, uint32_t now_ms);   /* at welcome */
void dog_heard(dog_t *d, uint32_t now_ms);   /* any frame, text or binary */
void dog_stop(dog_t *d);                     /* at a drop */
bool dog_expired(const dog_t *d, uint32_t now_ms);
