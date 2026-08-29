import { csvParser } from "../skills/csv/scripts/parse-csv.ts";
import {
  ARENA_PARSER_NAME,
  arenaParser,
  type ArenaParser,
} from "../skills/arena/scripts/parse-arena.ts";
import { ofxParser } from "../skills/ofx/scripts/parse-ofx.ts";
import { simpleFinParser } from "../skills/simplefin/scripts/parse-simplefin.ts";
import type { TransactionParser } from "./types.ts";

const parsers = new Map<string, TransactionParser | ArenaParser>([
  [arenaParser.name, arenaParser],
  [csvParser.name, csvParser],
  [ofxParser.name, ofxParser],
  [simpleFinParser.name, simpleFinParser],
]);

export const PARSER_NAMES = ["arena", "csv", "ofx", "simplefin"] as const;
export type ParserName = (typeof PARSER_NAMES)[number];
export const FILE_PARSER_NAMES = ["csv", "ofx"] as const;
export type FileParserName = (typeof FILE_PARSER_NAMES)[number];

export function parserFor(name: typeof ARENA_PARSER_NAME): ArenaParser | undefined;
export function parserFor(name: string): TransactionParser | undefined;
export function parserFor(name: string): TransactionParser | ArenaParser | undefined {
  return parsers.get(name);
}
