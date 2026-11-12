# Digital input hardware references

## HC-SR04 ultrasonic module

The initial reference is the 5 V HC-SR04 sold by SparkFun as SEN-15569, not
an unspecified 3.3 V ultrasonic module. Its four 2.54 mm header contacts are
VCC, TRIG, ECHO, GND. The ElecFreaks HC-SR04 sheet distributed by SparkFun
lists a 5 V supply, 15 mA working current, 2–400 cm range, a trigger pulse of
at least 10 µs and dimensions of approximately 45 × 20 × 15 mm. These are
reference values for the selected module, not a guarantee for every clone;
15 mA is a working-current figure, not a validated idle/peak model.

The output ECHO signal is 5 V. Adafruit explicitly warns against connecting
it directly to 3.3 V controller inputs. Level shifting must be designed and
verified for the real circuit. The sheet calls TRIG a TTL input but does not
specify a numeric high threshold, so 3.3 V trigger compatibility is not
assumed. The isolated laboratory demonstration uses bounded distances and
explicit trigger actions with idealized, explicitly assumed compatible wiring;
it does not validate the active workbench or model acoustic timing waveforms.
The `distance × 58 µs` ECHO duration is a nominal datasheet approximation,
not a measured waveform or hardware reading.

Sources: [SparkFun SEN-15569](https://www.sparkfun.com/ultrasonic-distance-sensor-hc-sr04.html),
[ElecFreaks HC-SR04 sheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf),
and [Adafruit's 5 V ECHO warning](https://learn.adafruit.com/distance-measurement-ultrasound-hcsr04/overview).

The separate three-pin button-module variant has not yet been selected or
sourced; the existing two-terminal push-button is an idealized passive switch.
