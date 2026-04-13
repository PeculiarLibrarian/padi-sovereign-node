export interface ReplayResult {
  valid:      boolean;
  height:     number;
  hash:       string;
  epochFloor: number;
  errors:     string[];
}
