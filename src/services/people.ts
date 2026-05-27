import { readFileSync } from "fs";
import { resolve, isAbsolute } from "path";
import yaml from "js-yaml";
import { loadConfig } from "../config.js";

interface PeopleConfig {
  aliasMap: Map<string, string>;
  dropSet: Set<string>;
}

let _cached: PeopleConfig | undefined;

function loadPeopleConfig(): PeopleConfig {
  if (_cached) return _cached;

  const config = loadConfig();
  const peopleFile = config.peopleFile;
  const vaultRoot = config.vaultRoot;

  if (!peopleFile) {
    _cached = { aliasMap: new Map(), dropSet: new Set() };
    return _cached;
  }

  const fullPath = isAbsolute(peopleFile)
    ? peopleFile
    : resolve(vaultRoot ?? ".", peopleFile);

  const raw = readFileSync(fullPath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    _cached = { aliasMap: new Map(), dropSet: new Set() };
    return _cached;
  }

  const aliasMap = new Map<string, string>();
  const dropSet = new Set<string>();

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_drop") {
      if (Array.isArray(value)) {
        for (const v of value) dropSet.add(String(v).toLowerCase());
      }
      continue;
    }
    if (key.startsWith("_")) continue;

    const canonical = key.toLowerCase();
    addAlias(aliasMap, canonical, canonical);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const aliases = (value as { aliases?: unknown }).aliases;
      if (Array.isArray(aliases)) {
        for (const a of aliases) addAlias(aliasMap, String(a).toLowerCase(), canonical);
      }
    }
  }

  _cached = { aliasMap, dropSet };
  return _cached;
}

function addAlias(map: Map<string, string>, alias: string, canonical: string): void {
  const existing = map.get(alias);
  if (existing && existing !== canonical) {
    throw new Error(
      `people.yaml: alias '${alias}' maps to both '${existing}' and '${canonical}'`
    );
  }
  map.set(alias, canonical);
}

export function canonicalizePeople(names: string[] | null | undefined): string[] {
  if (!names || names.length === 0) return [];
  const { aliasMap, dropSet } = loadPeopleConfig();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (dropSet.has(lower)) continue;
    const canonical = aliasMap.get(lower) ?? lower;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

export function _resetPeopleCacheForTests(): void {
  _cached = undefined;
}
