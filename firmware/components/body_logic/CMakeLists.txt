# Plain C11 + cJSON, no IDF headers: firmware/test builds the same sources on
# the computer.
idf_component_register(SRCS "proto.c"
                       INCLUDE_DIRS "include"
                       REQUIRES json)
