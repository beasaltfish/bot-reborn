#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cJSON.h>
#include "check.h"
#include "proto.h"
#include "motion.h"

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

/* The same cases sim/car.js's motorLevels passes (test/sim/motor-cases.test.js). */
int main(void) {
  cJSON *all = cJSON_Parse(read_file(MOTOR_CASES));
  CHECK(cJSON_IsArray(all));
  cJSON *c;
  cJSON_ArrayForEach(c, all) {
    const char *drive = cJSON_GetObjectItem(c, "drive")->valuestring;
    const char *steer = cJSON_GetObjectItem(c, "steer")->valuestring;
    drive_t d = strcmp(drive, "forward") == 0 ? DRIVE_FORWARD : DRIVE_BACKWARD;
    steer_t s = strcmp(steer, "left") == 0 ? STEER_LEFT
      : strcmp(steer, "right") == 0 ? STEER_RIGHT : STEER_STRAIGHT;
    calib_t cal = {
      .drive_swapped = cJSON_IsTrue(cJSON_GetObjectItem(c, "driveSwapped")),
      .steer_swapped = cJSON_IsTrue(cJSON_GetObjectItem(c, "steerSwapped")),
    };
    uint8_t pins[4];
    motor_levels(d, s, cal, pins);
    cJSON *want = cJSON_GetObjectItem(c, "pins");
    for (int i = 0; i < 4; i++) {
      CHECK_EQ_INT(pins[i], cJSON_IsTrue(cJSON_GetArrayItem(want, i)));
    }
  }
  CHECK_DONE();
}
