// The tarot wand's sensor. Reads the MPU-6050 and, when a shake has finished
// (shake.h), tells the brain. With no sensor it says so once and does nothing.

#pragma once

void imu_start(void);
