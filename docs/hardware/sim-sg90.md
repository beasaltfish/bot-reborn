# SG90 servo hardware reference

The selected actuator is the Tower Pro SG90 micro servo: about
22.8 × 12.2 × 28.5 mm and 9 g, with a three-wire lead in GND, VCC, SIG order.
It is specified for 4.8–6 V and a 50 Hz control signal; the usual pulse range is
500–2400 µs for roughly 180° of travel. The simulator clamps commands to that
range and treats a pulse outside it as the nearest safe value.

Current figures are model values derived from the common SG90 datasheet:
about 5 mA idle, 200 mA while moving and 700 mA stalled. Real stall current,
startup spikes and holding current vary by clone and load, and the servo can
draw far more than a GPIO or a small regulator can supply. The simulator
therefore refuses VCC on a GPIO, requires a common ground and reports a missing
or invalid 5 V supply. It does not model torque, gear wear, holding current,
inductive spikes or a real 180° mechanical limit.

The SG90 is not supported by the current real firmware; the firmware contract
is a PWM GPIO with a `setAngle` action and angle telemetry, marked separately
from electrical validity.

Sources: [Tower Pro SG90 product page](https://www.towerpro.com.tw/product/sg90-7/),
[SG90 datasheet](https://www.towerpro.com.tw/datasheet/SG90.pdf),
[Adafruit servo guidance](https://learn.adafruit.com/adafruit-arduino-lesson-14-servo-motors).
