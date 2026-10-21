#include "check.h"
#include "command.h"

static void kinds(void) {
  CHECK_EQ_INT(cmd_parse("help").kind, CMD_HELP);
  CHECK_EQ_INT(cmd_parse("cal").kind, CMD_CAL_SHOW);
  CHECK_EQ_INT(cmd_parse("cal drive").kind, CMD_CAL_DRIVE);
  CHECK_EQ_INT(cmd_parse("cal steer").kind, CMD_CAL_STEER);
  CHECK_EQ_INT(cmd_parse("reboot").kind, CMD_REBOOT);
}

static void whitespace_and_line_ends_are_ignored(void) {
  CHECK_EQ_INT(cmd_parse("  cal  drive\r\n").kind, CMD_CAL_DRIVE);
  CHECK_EQ_INT(cmd_parse("reboot\n").kind, CMD_REBOOT);
}

static void an_empty_line_is_invalid_without_a_message(void) {
  cmd_t c = cmd_parse("   \r\n");
  CHECK_EQ_INT(c.kind, CMD_INVALID);
  CHECK(c.error == NULL);
}

static void wifi_takes_an_ssid_and_a_password(void) {
  cmd_t c = cmd_parse("wifi Home secret123");
  CHECK_EQ_INT(c.kind, CMD_WIFI);
  CHECK_EQ_STR(c.a, "Home");
  CHECK_EQ_STR(c.b, "secret123");
}

static void a_quoted_ssid_keeps_its_spaces(void) {
  cmd_t c = cmd_parse("wifi \"My Home\" secret123");
  CHECK_EQ_INT(c.kind, CMD_WIFI);
  CHECK_EQ_STR(c.a, "My Home");
  CHECK_EQ_STR(c.b, "secret123");
  c = cmd_parse("wifi \"My Home\" \"pass with space\"");
  CHECK_EQ_STR(c.b, "pass with space");
}

static void an_open_network_has_no_password(void) {
  cmd_t c = cmd_parse("wifi CafeOpen");
  CHECK_EQ_INT(c.kind, CMD_WIFI);
  CHECK_EQ_STR(c.a, "CafeOpen");
  CHECK_EQ_STR(c.b, "");
}

static void wifi_refuses_what_wpa_would(void) {
  cmd_t c = cmd_parse("wifi x short");
  CHECK_EQ_INT(c.kind, CMD_INVALID);
  CHECK(c.error != NULL);
  CHECK_EQ_INT(cmd_parse("wifi").kind, CMD_INVALID);
  CHECK_EQ_INT(cmd_parse("wifi 123456789012345678901234567890123 password").kind, CMD_INVALID);
  CHECK_EQ_INT(cmd_parse("wifi \"unclosed password").kind, CMD_INVALID);
  CHECK_EQ_INT(cmd_parse("wifi a b c").kind, CMD_INVALID);
}

static void a_token_is_32_hex_and_stored_lowercase(void) {
  cmd_t c = cmd_parse("token 0123456789ABCDEF0123456789abcdef");
  CHECK_EQ_INT(c.kind, CMD_TOKEN);
  CHECK_EQ_STR(c.a, "0123456789abcdef0123456789abcdef");
  c = cmd_parse("token 0123456789abcdef0123456789abcde");
  CHECK_EQ_INT(c.kind, CMD_INVALID);
  CHECK_EQ_STR(c.error, "token must be 32 hex characters");
  CHECK_EQ_INT(cmd_parse("token 0123456789abcdef0123456789abcdeg").kind, CMD_INVALID);
}

static void a_url_is_ws(void) {
  cmd_t c = cmd_parse("url ws://192.168.3.79:8787/body");
  CHECK_EQ_INT(c.kind, CMD_URL);
  CHECK_EQ_STR(c.a, "ws://192.168.3.79:8787/body");
  c = cmd_parse("url http://192.168.3.79:8787/body");
  CHECK_EQ_INT(c.kind, CMD_INVALID);
  CHECK_EQ_STR(c.error, "url must start with ws://");
}

static void unknown_commands_and_arguments(void) {
  cmd_t c = cmd_parse("dance");
  CHECK_EQ_INT(c.kind, CMD_INVALID);
  CHECK_EQ_STR(c.error, "unknown command; type help");
  CHECK_EQ_INT(cmd_parse("cal sideways").kind, CMD_INVALID);
  CHECK_EQ_INT(cmd_parse("reboot now").kind, CMD_INVALID);
}

int main(void) {
  kinds();
  whitespace_and_line_ends_are_ignored();
  an_empty_line_is_invalid_without_a_message();
  wifi_takes_an_ssid_and_a_password();
  a_quoted_ssid_keeps_its_spaces();
  an_open_network_has_no_password();
  wifi_refuses_what_wpa_would();
  a_token_is_32_hex_and_stored_lowercase();
  a_url_is_ws();
  unknown_commands_and_arguments();
  CHECK_DONE();
}
