export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
