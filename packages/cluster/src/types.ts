export interface ClusterConfig {
  nodeId:         string;
  redisUrl:       string;
  leaderTtlMs:    number;
  pollIntervalMs: number;
  peers:          string[];
  mtls?:          MTLSConfig;
}

export interface MTLSConfig {
  certPath: string;
  keyPath:  string;
  caPath:   string;
}

export interface LeaderState {
  isLeader:     boolean;
  currentEpoch: number;
}
