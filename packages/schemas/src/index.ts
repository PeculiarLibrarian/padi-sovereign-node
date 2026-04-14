import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv";
import type { ValidateFunction } from "ajv";
import { Parser, Store, DataFactory, type Quad_Subject } from "n3";

const Ajv = (AjvModule as unknown as { default: typeof AjvModule }).default ?? AjvModule;

const { namedNode } = DataFactory;
const __dir = path.dirname(fileURLToPath(import.meta.url));
const DEFS  = path.resolve(__dir, "../definitions");

const NS = {
  sh:   "http://www.w3.org/ns/shacl#",
  padi: "http://padi.tech/schema#",
};

const sh  = (t: string) => namedNode(`${NS.sh}${t}`);
const pad = (t: string) => namedNode(`${NS.padi}${t}`);

export interface ValidationViolation {
  path:       string;
  constraint: string;
  value:      unknown;
  message:    string;
}

export interface ValidationResult {
  valid:      boolean;
  violations: ValidationViolation[];
}

export interface SchemaRegistry {
  validate(payload: unknown): boolean;
  validateSHACL(
    payload: Record<string, unknown>,
    options?: { strict?: boolean }
  ): ValidationResult;
  validateIdentity(): ValidationResult;
  authorizedPublicKeys: string[];
  contextRegistry: Map<string, string>;
}

export class ShaclError extends Error {
  constructor(public readonly violation: ValidationViolation) {
    super(violation.message);
    this.name = "ShaclError";
  }
}

function getNum(
  store: Store,
  node: Quad_Subject,
  pred: string
): number | undefined {
  const q = store.getQuads(node, sh(pred), null, null)[0];
  return q ? Number(q.object.value) : undefined;
}

function getStr(
  store: Store,
  node: Quad_Subject,
  pred: string
): string | undefined {
  return store.getQuads(node, sh(pred), null, null)[0]?.object.value;
}

function checkProperty(
  store: Store,
  propNode: Quad_Subject,
  fieldPath: string,
  value: unknown,
  violations: ValidationViolation[]
): void {
  const msg = getStr(store, propNode, "message") ?? fieldPath;

  const min = getNum(store, propNode, "minInclusive");
  if (min !== undefined && typeof value === "number" && value < min)
    violations.push({
      path: fieldPath, constraint: "minInclusive", value,
      message: `${msg}: ${value} < ${min}`,
    });

  const max = getNum(store, propNode, "maxInclusive");
  if (max !== undefined && typeof value === "number" && value > max)
    violations.push({
      path: fieldPath, constraint: "maxInclusive", value,
      message: `${msg}: ${value} > ${max}`,
    });

  const minLen = getNum(store, propNode, "minLength");
  if (minLen !== undefined && typeof value === "string" && value.length < minLen)
    violations.push({
      path: fieldPath, constraint: "minLength",
      value: `[len ${value.length}]`,
      message: `${msg}: length ${value.length} < ${minLen}`,
    });

  const maxLen = getNum(store, propNode, "maxLength");
  if (maxLen !== undefined && typeof value === "string" && value.length > maxLen)
    violations.push({
      path: fieldPath, constraint: "maxLength",
      value: `[len ${value.length}]`,
      message: `${msg}: length ${value.length} > ${maxLen}`,
    });

  const pattern = getStr(store, propNode, "pattern");
  if (
    pattern !== undefined &&
    typeof value === "string" &&
    !new RegExp(pattern).test(value)
  )
    violations.push({
      path: fieldPath, constraint: "pattern", value: "[string]",
      message: `${msg}: does not match /${pattern}/`,
    });
}

function validateShape(
  store: Store,
  shapeIri: string,
  record: Record<string, unknown>
): ValidationResult {
  const violations: ValidationViolation[] = [];
  const shapeNode = namedNode(shapeIri);
  const props = store.getQuads(shapeNode, sh("property"), null, null);

  if (!props.length)
    return {
      valid: false,
      violations: [{
        path: "shape", constraint: "exists", value: shapeIri,
        message: `UNKNOWN_SHACL_SHAPE: ${shapeIri}`,
      }],
    };

  for (const pq of props) {
    const propNode  = namedNode(pq.object.value);
    const pathQ     = store.getQuads(propNode, sh("path"), null, null)[0];
    if (!pathQ) continue;

    const fieldPath = pathQ.object.value.split(/[#/]/).pop() ?? "";
    const msg       = getStr(store, propNode, "message") ?? fieldPath;
    const value     = record[fieldPath];

    const minCount = getNum(store, propNode, "minCount");
    if (minCount !== undefined && minCount > 0 && value === undefined) {
      violations.push({
        path: fieldPath, constraint: "minCount", value: undefined,
        message: `${msg}: "${fieldPath}" is required`,
      });
      continue;
    }

    const maxCount = getNum(store, propNode, "maxCount");
    if (maxCount !== undefined && Array.isArray(value) && value.length > maxCount)
      violations.push({
        path: fieldPath, constraint: "maxCount",
        value: `[${value.length}]`,
        message: `${msg}: too many values`,
      });

    if (value !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        checkProperty(store, propNode, fieldPath, v, violations);
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export function loadRegistry(): SchemaRegistry {
  const schemaPath = path.join(DEFS, "schema.json");
  const ttlPath    = path.join(DEFS, "padi.ttl");

  if (!fs.existsSync(schemaPath))
    throw new Error(`REGISTRY_ERR: schema.json not found at ${schemaPath}`);
  if (!fs.existsSync(ttlPath))
    throw new Error(`REGISTRY_ERR: padi.ttl not found at ${ttlPath}`);

  const ajv = new Ajv({ allErrors: true, strict: true });
  const validator: ValidateFunction = ajv.compile(
    JSON.parse(fs.readFileSync(schemaPath, "utf8"))
  );

  const store  = new Store();
  const parser = new Parser();
  const quads  = parser.parse(fs.readFileSync(ttlPath, "utf8"));
  store.addQuads(quads);

  const authorizedPublicKeys = store
    .getQuads(null, pad("authorizedPublicKey"), null, null)
    .map((q) => q.object.value.trim())
    .filter((v) => v.startsWith("-----BEGIN"));

  if (!authorizedPublicKeys.length)
    throw new Error(
      "REGISTRY_ERR: No :authorizedPublicKey data triples found in padi.ttl. " +
      "Run node scripts/setup.js and paste the public key into padi.ttl."
    );

  const contextRegistry = new Map<string, string>();
  for (const rq of store.getQuads(pad("ContextRegistry"), null, null, null)) {
    const entry    = namedNode(rq.object.value);
    const nameQuad = store.getQuads(entry, pad("contextName"),  null, null)[0];
    const shapeQ   = store.getQuads(entry, pad("targetShape"), null, null)[0];
    if (nameQuad && shapeQ)
      contextRegistry.set(nameQuad.object.value, shapeQ.object.value);
  }

  function validate(payload: unknown): boolean {
    return !!validator(payload);
  }

  function validateSHACL(
    payload: Record<string, unknown>,
    options: { strict?: boolean } = {}
  ): ValidationResult {
    const { strict = true } = options;
    const context = payload["context"];

    if (!context || typeof context !== "string") {
      const v: ValidationViolation = {
        path: "context", constraint: "minCount", value: context,
        message: "MISSING_CONTEXT: payload.context is required",
      };
      if (strict) throw new ShaclError(v);
      return { valid: false, violations: [v] };
    }

    const shapeIri = contextRegistry.get(context);
    if (!shapeIri) {
      const v: ValidationViolation = {
        path: "context", constraint: "registry", value: context,
        message: `UNKNOWN_CONTEXT: "${context}" not in :ContextRegistry`,
      };
      if (strict) throw new ShaclError(v);
      return { valid: false, violations: [v] };
    }

    const result = validateShape(store, shapeIri, payload);
    if (!result.valid && strict) throw new ShaclError(result.violations[0]);
    return result;
  }

  function validateIdentity(): ValidationResult {
    const record: Record<string, unknown> = {};
    const nameQ = store.getQuads(pad("SamuelNode"), pad("name"), null, null)[0];
    if (nameQ) record["name"] = nameQ.object.value;
    const keyQs = store.getQuads(
      pad("SamuelNode"), pad("authorizedPublicKey"), null, null
    );
    if (keyQs.length === 1) {
      record["authorizedPublicKey"] = keyQs[0].object.value.trim();
    } else if (keyQs.length > 1) {
      record["authorizedPublicKey"] = keyQs.map((q) => q.object.value.trim());
    }
    return validateShape(store, `${NS.padi}IdentityShape`, record);
  }

  return {
    validate,
    validateSHACL,
    validateIdentity,
    authorizedPublicKeys,
    contextRegistry,
  };
}
