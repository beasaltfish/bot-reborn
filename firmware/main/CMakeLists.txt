idf_component_register(SRCS "main.c" "settings.c" "led.c" "console.c" "net.c" "link.c" "audio.c" "discover.c" "screen_link.c" "screen_draw.c" "motor.c" "screen.c" "imu.c"
                       INCLUDE_DIRS "."
                       REQUIRES body_logic mdns nvs_flash esp_wifi esp_event esp_netif esp_timer
                                esp_driver_gpio esp_driver_usb_serial_jtag esp_driver_i2s
                                esp_lcd esp_driver_spi esp_driver_i2c)
