// C-style reading material for the built-in sketch firmwares. Only the
// button-led example uses v1 API only and can be copied into "my firmware";
// the rest show the shape of the device APIs that come later.

const buttonLed = `void setup() {
  pinMode(4, INPUT);
  pinMode(5, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  if (digitalRead(4) == LOW) {
    digitalWrite(5, HIGH);
    Serial.println("pressed");
  } else {
    digitalWrite(5, LOW);
  }
  delay(100);
}`;

const bme280 = `void setup() {
  Serial.begin(115200);
  // bme280.begin() is not part of v1
}

void loop() {
  float t = bme280.readTemperature();
  Serial.println(t);
  delay(1000);
}`;

const sonar = `void setup() {
  Serial.begin(115200);
}

void loop() {
  int cm = sonar.measureCm();
  Serial.println(cm);
  delay(200);
}`;

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

const motor = `void setup() {
  motor.stop();
}

void loop() {
  motor.drive("forward", 0.6);
  delay(1000);
}`;

const strip = `void setup() {
  strip.begin();
}

void loop() {
  strip.fill(0, 160, 40);
  strip.show();
  delay(500);
}`;

/** @type {Record<string, { source: string, v1: boolean }>} */
export const EXAMPLES = {
  'sketch-bme280': { source: bme280, v1: false },
  'sketch-button-led': { source: buttonLed, v1: true },
  'sketch-sonar': { source: sonar, v1: false },
  'sketch-env-display': { source: envDisplay, v1: false },
  'sketch-sonar-servo': { source: sonarServo, v1: false },
  'sketch-motor': { source: motor, v1: false },
  'sketch-strip': { source: strip, v1: false },
};
