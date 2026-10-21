// When to knock again, and when the brain has gone quiet. The same rules as
// phone/body-link.js: a drop is retried with backoff, a reject is final, and
// a second with no frame of any kind means the brain is gone.

#pragma once
#include <stdbool.h>
#include <stdint.h>

#define LINK_WATCHDOG_MS 1000
#define LINK_HEARTBEAT_MS 300

typedef struct { int attempt; bool finished; } retry_t;
uint32_t retry_next_ms(retry_t *r);   /* 500, 1000, 2000, 5000, 5000, … */
void retry_welcomed(retry_t *r);      /* back to 500 */
void retry_rejected(retry_t *r);      /* finished: knocking again hears the same answer */

typedef struct { uint32_t last_heard_ms; bool live; } dog_t;
void dog_start(dog_t *d, uint32_t now_ms);   /* at welcome */
void dog_heard(dog_t *d, uint32_t now_ms);   /* any frame, text or binary */
void dog_stop(dog_t *d);                     /* at a drop */
bool dog_expired(const dog_t *d, uint32_t now_ms);
