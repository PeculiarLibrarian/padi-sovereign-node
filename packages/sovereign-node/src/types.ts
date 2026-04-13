export interface Payload {
  timestamp:                number;
  nonce:                    string;
  v:                        string;
  verifiedBy:               string;
  epoch:                    number;
  context:                  string;
  gridScore?:               number;
  invisibilityCoefficient?: number;
}

export interface Block {
  t:    number;
  h:    number;
  p:    string[];
  d:    Payload;
  s:    string;
  e:    number;
  hash: string;
}

export interface ReplayResult {
  valid:       boolean;
  height:      number;
  hash:        string;
  epochFloor:  number;
  errors:      string[];
}
