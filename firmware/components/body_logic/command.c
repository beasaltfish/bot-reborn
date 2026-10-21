#include <ctype.h>
#include <stdbool.h>
#include <string.h>
#include "command.h"

#define MAX_WORDS 4
#define WORD_CAP 128

/* Splits on whitespace; a double-quoted run is one word. -1 for an unclosed
   quote or a word too long, else the number of words (at most MAX_WORDS + 1,
   which means "too many"). */
static int split(const char *line, char words[MAX_WORDS + 1][WORD_CAP]) {
  int n = 0;
  const char *p = line;
  for (;;) {
    while (isspace((unsigned char)*p)) p++;
    if (!*p) return n;
    if (n > MAX_WORDS) return n;
    size_t len = 0;
    bool quoted = *p == '"';
    if (quoted) p++;
    while (*p && (quoted ? *p != '"' : !isspace((unsigned char)*p))) {
      if (len + 1 >= WORD_CAP) return -1;
      words[n][len++] = *p++;
    }
    if (quoted) {
      if (*p != '"') return -1;
      p++;
    }
    words[n][len] = '\0';
    n++;
  }
}

static cmd_t invalid(const char *why) {
  cmd_t c = {0};
  c.kind = CMD_INVALID;
  c.error = why;
  return c;
}

static cmd_t wifi(int n, char w[][WORD_CAP]) {
  const char *usage = "usage: wifi <ssid> [pass] — quote either to hold spaces";
  if (n < 2 || n > 3) return invalid(usage);
  size_t ssid = strlen(w[1]);
  size_t pass = n == 3 ? strlen(w[2]) : 0;
  if (ssid < 1 || ssid > 32) return invalid("ssid must be 1 to 32 bytes");
  if (pass != 0 && (pass < 8 || pass > 63)) return invalid("password must be empty or 8 to 63 characters");
  cmd_t c = {0};
  c.kind = CMD_WIFI;
  strcpy(c.a, w[1]);
  if (n == 3) strcpy(c.b, w[2]);
  return c;
}

static cmd_t token(int n, char w[][WORD_CAP]) {
  if (n != 2 || strlen(w[1]) != 32) return invalid("token must be 32 hex characters");
  cmd_t c = {0};
  for (int i = 0; i < 32; i++) {
    if (!isxdigit((unsigned char)w[1][i])) return invalid("token must be 32 hex characters");
    c.a[i] = (char)tolower((unsigned char)w[1][i]);
  }
  c.kind = CMD_TOKEN;
  return c;
}

static cmd_t url(int n, char w[][WORD_CAP]) {
  if (n != 2 || strncmp(w[1], "ws://", 5) != 0) return invalid("url must start with ws://");
  cmd_t c = {0};
  c.kind = CMD_URL;
  strcpy(c.a, w[1]);
  return c;
}

cmd_t cmd_parse(const char *line) {
  char w[MAX_WORDS + 1][WORD_CAP];
  int n = split(line, w);
  if (n < 0) return invalid("unclosed quote or an argument too long");
  if (n == 0) return invalid(NULL);

  cmd_t c = {0};
  if (strcmp(w[0], "help") == 0 && n == 1) { c.kind = CMD_HELP; return c; }
  if (strcmp(w[0], "reboot") == 0 && n == 1) { c.kind = CMD_REBOOT; return c; }
  if (strcmp(w[0], "cal") == 0) {
    if (n == 1) { c.kind = CMD_CAL_SHOW; return c; }
    if (n == 2 && strcmp(w[1], "drive") == 0) { c.kind = CMD_CAL_DRIVE; return c; }
    if (n == 2 && strcmp(w[1], "steer") == 0) { c.kind = CMD_CAL_STEER; return c; }
    return invalid("usage: cal | cal drive | cal steer");
  }
  if (strcmp(w[0], "wifi") == 0) return wifi(n, w);
  if (strcmp(w[0], "token") == 0) return token(n, w);
  if (strcmp(w[0], "url") == 0) return url(n, w);
  if (strcmp(w[0], "help") == 0 || strcmp(w[0], "reboot") == 0) return invalid("this command takes no arguments");
  return invalid("unknown command; type help");
}
