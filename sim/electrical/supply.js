// Coarse DC models. Voltages are volts, currents milliamps, resistances ohms.
/** @typedef {number | {property: string} | {profileRail: string}} NumericValue */
/** @typedef {'idle'|'startup'|'peak'|'stall'} OperatingMode */
/** @typedef {{ kind: 'source', positive: string, negative: string, voltage: NumericValue, currentLimitMa: NumericValue, internalResistanceOhm: NumericValue }} SourceModel */
/** @typedef {{ kind: 'regulator', input: string, output: string, ground: string, voltage: NumericValue, dropoutVoltage: NumericValue, efficiency: NumericValue, currentLimitMa: NumericValue }} RegulatorModel */
/** @typedef {{ kind: 'supply'|'load', positive: string, ground?: string, negative?: string, currentsMa: Partial<Record<OperatingMode, NumericValue>>, minVoltage?: NumericValue, maxVoltage?: NumericValue, maxPowerMw?: NumericValue }} LoadModel */
/** @typedef {{ voltage: number, requestedCurrentMa: number, deliveredCurrentMa: number, sourceInstances: string[], status: 'off'|'ok'|'dropout'|'limited'|'contended'|'reversed' }} RailState */
/** @typedef {{ voltage: number, currentMa: number, status: 'ok'|'unpowered'|'brownout'|'reversed'|'overvoltage'|'overpower' }} DeviceElectricalState */
/** @typedef {{ code: string, severity: 'info'|'warning'|'error'|'destructive', instances: string[], points: string[], values: Record<string, number> }} ElectricalFault */
/** @typedef {{ rails: Record<string, RailState>, devices: Record<string, DeviceElectricalState>, faults: ElectricalFault[], burns: string[] }} ElectricalOutcome */
/** @typedef {{ capabilities: object[] }} ElectricalDevice */

export {};
