// C-style reading material for the two remaining composite sketch firmwares.
// They show the shape of the device APIs; single-device lessons are bodies.

const envDisplay = `void setup() {
  Serial.begin(115200);
}

void loop() {
  display.line(0, "T 22.0 C");
  display.line(1, "H 50 %");
  display.show();
  delay(1000);
}`;

const sonarServo = `void setup() {
  servo.attach(9);
}

void loop() {
  int cm = sonar.measureCm();
  if (cm < 20) {
    servo.write(90);
  } else {
    servo.write(0);
  }
  delay(100);
}`;

/** @type {Record<string, { source: string, v1: boolean }>} */
export const EXAMPLES = {
  'sketch-env-display': { source: envDisplay, v1: false },
  'sketch-sonar-servo': { source: sonarServo, v1: false },
};
