// One line typed on the serial console, read. Setting up the body (Wi-Fi,
// token, brain address) and calibrating it share this one parser; acting on
// the result is the console's job. Messages are English: this is an
// instrument, not the product.

#pragma once

typedef enum { CMD_INVALID, CMD_HELP, CMD_CAL_SHOW, CMD_CAL_DRIVE, CMD_CAL_STEER,
               CMD_WIFI, CMD_TOKEN, CMD_URL, CMD_REBOOT } cmd_kind_t;

typedef struct {
  cmd_kind_t kind;
  char a[128];          /* wifi's ssid, the token (lowercased), the url */
  char b[65];           /* wifi's password, possibly empty */
  const char *error;    /* why, for CMD_INVALID; NULL for an empty line */
} cmd_t;

/* Arguments may be double-quoted to hold spaces; there are no escapes. */
cmd_t cmd_parse(const char *line);
