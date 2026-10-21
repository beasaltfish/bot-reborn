#include "check.h"
#include "led_table.h"

static void every_session_state_has_a_mode(void) {
  const char *names[] = {"SLEEPING", "LISTENING", "CAPTURING", "THINKING", "SPEAKING"};
  const led_mode_t modes[] = {LED_SLEEPING, LED_LISTENING, LED_CAPTURING, LED_THINKING, LED_SPEAKING};
  for (int i = 0; i < 5; i++) {
    led_mode_t m = LED_NO_WIFI;
    CHECK(led_mode_for_state(names[i], &m));
    CHECK_EQ_INT(m, modes[i]);
  }
}

static void an_unknown_state_leaves_the_mode_alone(void) {
  led_mode_t m = LED_THINKING;
  CHECK(!led_mode_for_state("DANCING", &m));
  CHECK_EQ_INT(m, LED_THINKING);
}

static void the_table_is_the_plans(void) {
  CHECK_EQ_INT(led_pattern(LED_NO_WIFI).on_ms, 100);    CHECK_EQ_INT(led_pattern(LED_NO_WIFI).off_ms, 100);
  CHECK_EQ_INT(led_pattern(LED_CONNECTING).on_ms, 100); CHECK_EQ_INT(led_pattern(LED_CONNECTING).off_ms, 900);
  CHECK_EQ_INT(led_pattern(LED_REJECTED).on_ms, 1000);  CHECK_EQ_INT(led_pattern(LED_REJECTED).off_ms, 1000);
  CHECK_EQ_INT(led_pattern(LED_SLEEPING).on_ms, 50);    CHECK_EQ_INT(led_pattern(LED_SLEEPING).off_ms, 2950);
  CHECK_EQ_INT(led_pattern(LED_LISTENING).off_ms, 0);
  CHECK_EQ_INT(led_pattern(LED_CAPTURING).on_ms, 50);   CHECK_EQ_INT(led_pattern(LED_CAPTURING).off_ms, 50);
  CHECK_EQ_INT(led_pattern(LED_THINKING).on_ms, 250);   CHECK_EQ_INT(led_pattern(LED_THINKING).off_ms, 250);
  CHECK_EQ_INT(led_pattern(LED_SPEAKING).off_ms, 0);
}

int main(void) {
  every_session_state_has_a_mode();
  an_unknown_state_leaves_the_mode_alone();
  the_table_is_the_plans();
  CHECK_DONE();
}
