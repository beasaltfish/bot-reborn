# TB6612FNG and small DC motor reference

The selected driver is the Toshiba TB6612FNG dual H-bridge on a 20.3 × 20.3 mm
breakout (SparkFun ROB-14450 class). Logic VCC is 2.7–5.5 V and motor VM is
4.5–13.5 V; the datasheet gives 1.2 A continuous and 3.2 A peak per channel.
STBY must be high, AIN1/AIN2 select direction and PWMA/PWMB set speed. The
breakout has two header rows; the simulator lays the same pin names in one row
and does not claim that the physical order matches a particular clone.

The selected motor is a generic small 5 V geared DC motor with two equivalent
terminals. The simulator uses about 100 mA no-load, 400 mA loaded and 1.2 A
stalled as model values; real motors vary widely. Swapping the two motor
terminals reverses rotation. Current draw, startup spikes, back-EMF,
inductance, gear wear, thermal shutdown and the driver's internal protection
are not modeled beyond the declared states.

The driver is not supported by the current real firmware. Its firmware contract
declares direction, PWM and standby GPIOs plus drive/brake/coast actions, kept
separate from electrical validity.

Sources: [Toshiba TB6612FNG datasheet](https://toshiba.semicon-storage.com/info/TB6612FNG_datasheet_en_20141001.pdf),
[SparkFun TB6612FNG breakout](https://www.sparkfun.com/products/14450),
[Pololu motor driver guidance](https://www.pololu.com/docs/0J15).
