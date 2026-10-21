// Just enough of a test harness: a failed check prints where and what, and
// the test's exit code is the number of failures.

#pragma once
#include <stdio.h>
#include <string.h>

static int check_failures = 0;

#define CHECK(cond) do { if (!(cond)) { \
  fprintf(stderr, "%s:%d: CHECK(%s) failed\n", __FILE__, __LINE__, #cond); check_failures++; } } while (0)

#define CHECK_EQ_INT(a, b) do { long long check_a = (long long)(a), check_b = (long long)(b); \
  if (check_a != check_b) { fprintf(stderr, "%s:%d: %s == %lld, want %s == %lld\n", \
    __FILE__, __LINE__, #a, check_a, #b, check_b); check_failures++; } } while (0)

#define CHECK_EQ_STR(a, b) do { const char *check_a = (a), *check_b = (b); \
  if (strcmp(check_a, check_b) != 0) { fprintf(stderr, "%s:%d: %s == \"%s\", want \"%s\"\n", \
    __FILE__, __LINE__, #a, check_a, check_b); check_failures++; } } while (0)

#define CHECK_DONE() do { if (check_failures) fprintf(stderr, "%d check(s) failed\n", check_failures); \
  return check_failures; } while (0)
