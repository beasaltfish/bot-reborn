#include <stdio.h>
#include "proto.h"

void app_main(void) {
  printf("body: protocol %d\n", PROTO_VERSION);
}
