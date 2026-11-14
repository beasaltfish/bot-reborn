# WS2812 addressable strip hardware reference

The selected light is a short WS2812B/NeoPixel strip with 5 V, DIN and GND at
the input end and DOUT at the output end. Each pixel contains an RGB LED and a
controller; pixels are addressed over a single data line at roughly 800 kHz.
The simulator treats a strip as 1–60 pixels and models current only: about
20 mA per fully lit colour channel plus 1 mA idle, so a white pixel is about
61 mA and white is the peak case.

The WS2812B data input expects a logic high of about 0.7 × VDD. On a 5 V strip
that is roughly 3.5 V, so many 3.3 V controllers need a level shifter even
though some strips work in practice. The simulator therefore reports
`logic-level-incompatible` when a 3.3 V GPIO drives a 5 V strip. Data direction
matters: the controller must drive DIN, not DOUT. Bit timing, refresh rate,
colour order, gamma, power injection along long strips and thermal limits are
not modeled.

The strip is not supported by the current real firmware. Its firmware contract
declares a one-wire output and a `show` action, kept separate from electrical
validity. A weak shared supply is aggregated with the servo and motor in the
mixed-power model, so simultaneous startup loads can brown out the rail.

Sources: [Worldsemi WS2812B datasheet](https://www.codenwell.com/WS2812B.pdf),
[Adafruit NeoPixel guide](https://learn.adafruit.com/adafruit-neopixel-uberguide),
[Adafruit NeoPixel power notes](https://learn.adafruit.com/adafruit-neopixel-uberguide/powering-neopixels).
