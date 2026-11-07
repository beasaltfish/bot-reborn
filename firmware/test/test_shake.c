#include <stdio.h>
#include <stdlib.h>
#include <cJSON.h>
#include "check.h"
#include "proto.h"
#include "shake.h"

static char *read_file(const char *path) {
  FILE *f = fopen(path, "rb");
  if (!f) { perror(path); exit(1); }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  rewind(f);
  char *buf = malloc((size_t)n + 1);
  if (fread(buf, 1, (size_t)n, f) != (size_t)n) exit(1);
  buf[n] = '\0';
  fclose(f);
  return buf;
}

/* The same cases core/shake-detector.js passes (test/shake-detector.test.js). */
int main(void) {
  char *text = read_file(SHAKE_CASES);
  cJSON *all = cJSON_Parse(text);
  CHECK(cJSON_IsArray(all));
  cJSON *c;
  cJSON_ArrayForEach(c, all) {
    const char *name = cJSON_GetObjectItem(c, "name")->valuestring;
    cJSON *fires = cJSON_GetObjectItem(c, "fires");
    shake_t s;
    shake_init(&s);
    int next = 0, count = cJSON_GetArraySize(fires);
    cJSON *sample;
    cJSON_ArrayForEach(sample, cJSON_GetObjectItem(c, "samples")) {
      uint32_t ms = (uint32_t)cJSON_GetArrayItem(sample, 0)->valuedouble;
      float level = (float)cJSON_GetArrayItem(sample, 1)->valuedouble;
      if (shake_feed(&s, level, ms)) {
        if (next < count && (uint32_t)cJSON_GetArrayItem(fires, next)->valuedouble == ms) next++;
        else { fprintf(stderr, "%s: fired unexpectedly at %u\n", name, ms); check_failures++; }
      }
    }
    if (next != count) { fprintf(stderr, "%s: fired %d of %d\n", name, next, count); check_failures++; }
  }
  CHECK_EQ_STR(PROTO_SHAKE, "{\"type\":\"shake\"}");
  cJSON_Delete(all);
  free(text);
  CHECK_DONE();
}
