#include "link_policy.h"

static const uint32_t RETRY_MS[] = {500, 1000, 2000, 5000};
#define RETRIES ((int)(sizeof RETRY_MS / sizeof RETRY_MS[0]))

uint32_t retry_next_ms(retry_t *r) {
  uint32_t wait = RETRY_MS[r->attempt < RETRIES ? r->attempt : RETRIES - 1];
  if (r->attempt < RETRIES) r->attempt++;
  return wait;
}

void retry_welcomed(retry_t *r) { r->attempt = 0; }

void retry_rejected(retry_t *r) { r->finished = true; }

void dog_start(dog_t *d, uint32_t now_ms) { d->live = true; d->last_heard_ms = now_ms; }

void dog_heard(dog_t *d, uint32_t now_ms) { d->last_heard_ms = now_ms; }

void dog_stop(dog_t *d) { d->live = false; }

bool dog_expired(const dog_t *d, uint32_t now_ms) {
  return d->live && (uint32_t)(now_ms - d->last_heard_ms) > LINK_WATCHDOG_MS;
}
