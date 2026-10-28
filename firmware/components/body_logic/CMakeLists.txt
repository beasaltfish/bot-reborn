# Plain C11 + cJSON, no IDF headers: firmware/test builds the same sources on
# the computer.
#
# `cjson`, not `json`: IDF 5.x shipped cJSON as a component called `json`, 6.x
# moved it to the component registry under this name. The managed component
# builds on both, so the firmware does not care which IDF it is given — and
# `firmware/test` fetches its own copy, which is what keeps the host tests
# independent of the IDF version.
idf_component_register(SRC_DIRS "."
                       INCLUDE_DIRS "include"
                       REQUIRES cjson)
