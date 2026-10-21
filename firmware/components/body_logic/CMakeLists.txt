# Plain C11 + cJSON, no IDF headers: firmware/test builds the same sources on
# the computer.
idf_component_register(SRC_DIRS "."
                       INCLUDE_DIRS "include"
                       REQUIRES json)
