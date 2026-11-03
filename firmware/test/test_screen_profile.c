#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cJSON.h>
#include "check.h"
#include "screen_profile.h"

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

static controller_t controller_of(const char *name) {
  if (strcmp(name, "ili9341") == 0) return CTRL_ILI9341;
  if (strcmp(name, "st7789") == 0) return CTRL_ST7789;
  if (strcmp(name, "st7735") == 0) return CTRL_ST7735;
  if (strcmp(name, "gc9a01") == 0) return CTRL_GC9A01;
  fprintf(stderr, "unknown controller %s\n", name);
  exit(1);
}

static int num(const cJSON *row, const char *key) { return cJSON_GetObjectItem(row, key)->valueint; }
static int flag(const cJSON *row, const char *key) { return cJSON_IsTrue(cJSON_GetObjectItem(row, key)); }

/* core/screens.json is the one source of truth (the simulator and the render
   script read it); the C table must be the same rows, field for field. */
static void the_table_equals_core_screens_json(void) {
  char *text = read_file(SCREENS_JSON);
  cJSON *root = cJSON_Parse(text);
  const cJSON *rows = cJSON_GetObjectItem(root, "screens");
  CHECK(cJSON_IsArray(rows));
  CHECK_EQ_INT(screen_profile_count(), cJSON_GetArraySize(rows));
  const cJSON *row;
  cJSON_ArrayForEach(row, rows) {
    const char *id = cJSON_GetObjectItem(row, "id")->valuestring;
    const screen_profile_t *p = screen_profile_find(id);
    if (!p) { fprintf(stderr, "no C profile for %s\n", id); check_failures++; continue; }
    CHECK_EQ_STR(p->id, id);
    CHECK_EQ_STR(p->label, cJSON_GetObjectItem(row, "label")->valuestring);
    CHECK_EQ_INT(p->controller, controller_of(cJSON_GetObjectItem(row, "controller")->valuestring));
    CHECK_EQ_INT(p->w, num(row, "w"));
    CHECK_EQ_INT(p->h, num(row, "h"));
    CHECK_EQ_INT(p->invert, flag(row, "invert"));
    CHECK_EQ_INT(p->bgr, flag(row, "bgr"));
    CHECK_EQ_INT(p->swap_xy, flag(row, "swapXY"));
    CHECK_EQ_INT(p->mirror_x, flag(row, "mirrorX"));
    CHECK_EQ_INT(p->mirror_y, flag(row, "mirrorY"));
    CHECK_EQ_INT(p->gap_x, num(row, "gapX"));
    CHECK_EQ_INT(p->gap_y, num(row, "gapY"));
    CHECK_EQ_INT(p->spi_mode, num(row, "spiMode"));
    CHECK_EQ_INT(p->pclk_hz, num(row, "pclkHz"));
    CHECK_EQ_INT(p->verified, flag(row, "verified"));
  }
  cJSON_Delete(root);
  free(text);
}

static void find_knows_ids_and_the_two_ili9341_differ_in_inversion(void) {
  CHECK(screen_profile_find("nope") == NULL);
  CHECK(screen_profile_find("") == NULL);
  CHECK(screen_profile_find("ili9341-tn") != NULL);
  CHECK_EQ_INT(screen_profile_find("ili9341-tn")->invert, 0);    /* the 2.4" TN panel */
  CHECK_EQ_INT(screen_profile_find("ili9341-ips")->invert, 1);   /* the 2.8" IPS panel */
  CHECK(screen_profile_at(0) == screen_profile_find(screen_profile_at(0)->id));
  CHECK(screen_profile_at(screen_profile_count()) == NULL);
}

int main(void) {
  the_table_equals_core_screens_json();
  find_knows_ids_and_the_two_ili9341_differ_in_inversion();
  CHECK_DONE();
}
