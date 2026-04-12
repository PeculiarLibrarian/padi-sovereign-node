import type { Block, Payload } from "./types";
import type { SchemaRegistry } from "@samuelmuriithi/schemas";
import type { ClusterManager } from "@samuelmuriithi/cluster";
export declare class PadiEngine {
    private readonly registry;
    private db;
    private cache;
    heightIndex: Map<number, string>;
    tips: string[];
    currentHeight: number;
    lastTimestamp: number;
    currentEpoch: number;
    isLeader: boolean;
    private mutex;
    cluster: ClusterManager | null;
    private readonly publicKeys;
    constructor(registry: SchemaRegistry);
    bootstrap(): Promise<void>;
    ingest(payload: Payload, signature: string): Promise<Block>;
    private persistBlock;
    private hasNonce;
    close(): Promise<void>;
}
//# sourceMappingURL=engine.d.ts.map