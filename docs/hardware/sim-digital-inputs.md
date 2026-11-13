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

The separate three-pin button-module variant is the Joy-IT KY-004: three 2.54 mm
pins labelled S, VCC (middle) and GND, an 18.5 × 15 mm board, a FZ1713 tactile
switch and a 10 kΩ resistor. The selected Joy-IT datasheet describes a pull-up
arrangement: S rests high and is pulled to ground while the button is held. Some
clones use the opposite pull-down arrangement and drive S high when pressed, so
the resting level must be measured on the real module. The simulator models the
selected pull-up variant at 3.3 V or 5 V; the signal follows VCC, so powering it
from 5 V makes S a 5 V signal.

Sources: [Joy-IT KY-004 datasheet](https://joy-it.net/files/files/Produkte/COM-KY004TM/COM-KY004TM-Datasheet-20200408.pdf),
[Joy-IT KY-004 manual](https://www.joy-it.net/files/files/Produkte/COM-KY004TM/COM-KY004TM_Manual_2024-05-06.pdf),
[KY-004 module notes](https://arduinomodules.info/ky-004-key-switch-module/).
