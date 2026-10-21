# The body's logic, built and tested on the computer: everything in
# components/body_logic is plain C11 + cJSON, so it runs here as it runs on
# the chip. `npm run firmware:test` drives this.

cmake_minimum_required(VERSION 3.20)
project(body_logic_host_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Only cJSON's source: its own CMakeLists asks for a CMake older than 3.5,
# which current CMake refuses. SOURCE_SUBDIR points at a directory with no
# CMakeLists, so MakeAvailable downloads without configuring it.
include(FetchContent)
FetchContent_Declare(cjson
  GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git
  GIT_TAG v1.7.18
  GIT_SHALLOW TRUE
  SOURCE_SUBDIR source-only)
FetchContent_MakeAvailable(cjson)
add_library(cjson STATIC ${cjson_SOURCE_DIR}/cJSON.c)
target_include_directories(cjson PUBLIC ${cjson_SOURCE_DIR})

set(LOGIC ${CMAKE_CURRENT_SOURCE_DIR}/../components/body_logic)
file(GLOB LOGIC_SRCS ${LOGIC}/*.c)
add_library(body_logic STATIC ${LOGIC_SRCS})
# On the chip cJSON comes from IDF's json component as <cJSON.h>; same here.
target_include_directories(body_logic PUBLIC ${LOGIC}/include)
target_link_libraries(body_logic PUBLIC cjson)
target_compile_options(body_logic PRIVATE -Wall -Wextra -Werror)

enable_testing()
file(GLOB TESTS ${CMAKE_CURRENT_SOURCE_DIR}/test_*.c)
foreach(src ${TESTS})
  get_filename_component(name ${src} NAME_WE)
  add_executable(${name} ${src})
  target_link_libraries(${name} body_logic)
  target_compile_options(${name} PRIVATE -Wall -Wextra -Werror)
  target_compile_definitions(${name} PRIVATE VECTORS="${CMAKE_CURRENT_SOURCE_DIR}/brain-messages.json")
  add_test(NAME ${name} COMMAND ${name})
endforeach()
