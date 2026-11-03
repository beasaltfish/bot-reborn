# ESP32 body: things that went wrong, and what they looked like

Each entry is a real session's worth of debugging, kept as *symptom → cause →
fix*, so the next person can recognise it in a minute. Newest at the bottom of
each section. If a symptom matches, try the fix before reading code.

## Audio

### The speaker crackles, but only while it speaks, and only with the screen wired

- **Symptom:** silence is clean; speech comes out with a fast crackle. It goes
  away if every screen wire is unplugged. Unplugging only the screen's power
  (VCC, backlight) does *not* help.
- **Cause:** the screen's SPI clock (GPIO 11) is the header pin right next to
  the I2S bit clock (GPIO 12). At full GPIO drive its fast edges couple into the
  BCLK jumper. A glitch on BCLK shifts the bits of a real sample but leaves a
  stream of zeros alone, which is why silence sounds fine.
- **Fix:** drive the screen's outputs (SCK, MOSI, CS, DC) at the weakest level,
  `GPIO_DRIVE_CAP_0` (`screen.c`), as `audio.c` already does for BCLK/WS. Keep
  the SCK and BCLK wires apart on the breadboard.
- **How we found it:** unplug wires in groups until it stops (power vs signal),
  and ask whether it is audible when idle. A fault that only shows with
  *content* points at data or clock integrity, not at supply noise.

## Screen

### Fine horizontal stripes, in random places, even on a still picture

- **Symptom:** thin horizontal lines that move around and flicker, also when the
  idle animation barely changes. Lowering the SPI clock from 20 to 10 MHz did not
  fix it.
- **Cause:** `esp_lcd_panel_draw_bitmap` only *queues* the transfer; the driver
  reads the pixels from your buffer later, by DMA. Reusing one band buffer for
  the next band before that finishes mixes two bands.
- **Fix:** wait for `on_color_trans_done` after every draw before touching the
  buffer again (`draw()` in `screen.c`).
- **Lesson:** a symptom that survives the obvious knob (clock, drive strength)
  is usually ours. Re-read how the code hands data to the driver.

### Colours are wrong (red looks blue, green looks purple)

- **Cause:** SPI panels read RGB565 high byte first; an ESP32 stores the
  `uint16_t` low byte first, so the two bytes arrive swapped.
- **Fix:** swap the bytes (`rgb565()` in `screen.c`; the JPEG decoder is asked
  for `swap_color_bytes`). If only red and blue trade places, it is `bgr` in the
  profile instead.

### The picture is a negative

- **Cause:** panels differ in whether inversion must be on. The 2.8" IPS needs
  it, the 2.4" TN does not. It is a field of the screen profile
  (`core/screens.json`), not a constant.

## Flashing and the serial port

### "Invalid head of packet (0x1): Possible serial noise or corruption"

- **Cause:** another program has the same serial port open, usually
  `idf.py monitor` left running in a terminal. Two readers share the bytes, and
  the flasher's stream gets log lines mixed in.
- **Fix:** quit the monitor (`Ctrl-]`) before using the admin page or `idf.py
  flash`. `lsof /dev/cu.usbmodem*` shows who holds the port. "Port is busy" is
  the same cause.

### The board does not answer on the console after a failed flash

- **Cause:** esptool resets the chip into the ROM bootloader (download mode) to
  flash. If it fails half-way, nothing resets it back, and there is no program,
  so no console.
- **Fix:** press RESET (or replug USB), then try again.

### The board's two USB ports

- The ESP32-S3 DevKitC clones have a UART port and a native USB-Serial-JTAG
  port. The app's console is only on the **USB** one (`cu.usbmodem*`).
  `cu.usbserial*` shows the ROM boot lines and then nothing.

## Network and discovery

### The board dials an old address although discovery is on

- **Cause:** a `url` typed by hand once is stored in NVS and wins over mDNS
  forever. Settings survive reflashing.
- **Fix:** `url auto` clears it. The admin page's setup sends it every time.
  General rule: when a feature adds a new default, check what an old stored
  value does to it.

### mDNS finds the brain but at the wrong address

- **Cause:** a computer answers with *every* address it has, virtual-machine and
  VPN networks included (`192.168.97.0`-style), and the PTR answer carries only
  one of them. Taking the first one dials an address the Wi-Fi cannot reach.
- **Fix:** ask for all the host's A records and pick the one on the board's own
  subnet (`ipv4_pick`, `discover.c`).

### The brain advertises an address the computer no longer has

- **Cause:** the announcement was made at start-up; the computer then changed
  network (Wi-Fi band, new router) and got a new IP.
- **Fix:** `keepPublished` in `server/discovery.js` compares addresses every
  10 s and announces again on a change.

### `http://localhost:8787` shows 404 while the brain is running

- **Cause:** another program (here `wrangler dev`) listens on the same port on
  `127.0.0.1`/`::1`, which is more specific than the brain's wildcard listener,
  so `localhost` reaches it first.
- **Fix:** `PORT=8788 npm start`, or stop the other program. `lsof -nP
  -iTCP:8787 -sTCP:LISTEN` shows both.

## Flash, memory and build

### The app partition is full

- **Cause:** ESP-IDF defaults a new project to 2 MB flash and a 1 MB app
  partition, even on a 16 MB chip. Adding mDNS and the screen pushed the app to
  98%.
- **Fix:** `partitions.csv`: two 4 MB app slots (room for OTA), `nvs` left at
  `0x9000` so a reflash keeps Wi-Fi and token. Delete `firmware/sdkconfig` after
  any `sdkconfig.defaults` change, or the old value stays.

### Habits that saved time

- **Read the board's log yourself** (a few lines of pyserial that resets the
  chip and prints for 20 s) before asking anyone to describe what they see.
- **Change one variable per flash**, and say what outcome would confirm or kill
  the guess before running it. Both the speaker and the stripes needed a second
  guess; neither was where the first one pointed.
- **Verify each claim on the real board**, including the ones the host tests
  cannot reach (DMA ownership, byte order, which port).

## Still open

- The body's WebSocket dropped every few seconds in one session even against the
  fake brain and on a phone hotspot (ping to the board swung 15 ms to 2 s). It
  was not diagnosed; later sessions did not show it again.
- The 2.4" panel runs at 10 MHz (the ILI9341 is rated for about 10 MHz writes).
  That gives about 4 drawn frames a second. 20 MHz was never retried after the
  stripes were fixed.
