import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as contracts from "@/contracts/types";
import * as lib from "@/lib/types";
import type {
  Repo as ContractRepo,
  Group as ContractGroup,
  Tag as ContractTag,
  Settings as ContractSettings,
  ScanProgressEvent as ContractScanProgressEvent,
  SearchHit as ContractSearchHit,
  ApiError as ContractApiError,
} from "@/contracts/types";
import type {
  Repo as LibRepo,
  Group as LibGroup,
  Tag as LibTag,
  Settings as LibSettings,
  ScanProgressEvent as LibScanProgressEvent,
  SearchHit as LibSearchHit,
  ApiError as LibApiError,
} from "@/lib/types";

/**
 * contracts/README.md domain rule: lib/types.ts is the runtime copy of
 * contracts/types.ts and MUST be kept in lockstep.
 *
 * We verify two ways:
 *   1. Runtime: both modules export the same named symbols.
 *   2. Types: bi-directional structural assignability via `satisfies` +
 *      variable-assignment tricks. If either file drifts, tsc will fail.
 */

describe("contract/types — lib/types.ts mirrors contracts/types.ts", () => {
  it("both modules export the same named symbols (runtime marker parity)", () => {
    // Type-only modules have no runtime exports, so this is mostly a sanity
    // check that both files at least parse to the same import keys.
    const contractKeys = Object.keys(contracts).sort();
    const libKeys = Object.keys(lib).sort();
    expect(libKeys).toEqual(contractKeys);
  });

  it("source files are byte-equivalent after whitespace normalization", () => {
    const contractSrc = fs.readFileSync(
      path.join(process.cwd(), "contracts/types.ts"),
      "utf8",
    );
    const libSrc = fs.readFileSync(
      path.join(process.cwd(), "lib/types.ts"),
      "utf8",
    );
    const norm = (s: string) =>
      s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    expect(norm(libSrc)).toBe(norm(contractSrc));
  });

  it("types are bi-directionally structurally assignable (compile-time)", () => {
    // The real assertions are the variable declarations below. If any type
    // drifts, `tsc --noEmit` will fail at the type assignment.
    const asLibRepo = (x: ContractRepo): LibRepo => x;
    const asContractRepo = (x: LibRepo): ContractRepo => x;
    const asLibGroup = (x: ContractGroup): LibGroup => x;
    const asContractGroup = (x: LibGroup): ContractGroup => x;
    const asLibTag = (x: ContractTag): LibTag => x;
    const asContractTag = (x: LibTag): ContractTag => x;
    const asLibSettings = (x: ContractSettings): LibSettings => x;
    const asContractSettings = (x: LibSettings): ContractSettings => x;
    const asLibScanEv = (
      x: ContractScanProgressEvent,
    ): LibScanProgressEvent => x;
    const asContractScanEv = (
      x: LibScanProgressEvent,
    ): ContractScanProgressEvent => x;
    const asLibSearch = (x: ContractSearchHit): LibSearchHit => x;
    const asContractSearch = (x: LibSearchHit): ContractSearchHit => x;
    const asLibApiError = (x: ContractApiError): LibApiError => x;
    const asContractApiError = (x: LibApiError): ContractApiError => x;

    // Touch them so tsc keeps them in the output.
    expect(typeof asLibRepo).toBe("function");
    expect(typeof asContractRepo).toBe("function");
    expect(typeof asLibGroup).toBe("function");
    expect(typeof asContractGroup).toBe("function");
    expect(typeof asLibTag).toBe("function");
    expect(typeof asContractTag).toBe("function");
    expect(typeof asLibSettings).toBe("function");
    expect(typeof asContractSettings).toBe("function");
    expect(typeof asLibScanEv).toBe("function");
    expect(typeof asContractScanEv).toBe("function");
    expect(typeof asLibSearch).toBe("function");
    expect(typeof asContractSearch).toBe("function");
    expect(typeof asLibApiError).toBe("function");
    expect(typeof asContractApiError).toBe("function");
  });
});
