import type { MediaObject, Vibe } from "@rnet/types";
import type { VIBE_VIEWS } from "@rhizome/store-contract";

export type View = (typeof VIBE_VIEWS)[number];
export type Config = Record<string, unknown>;
export interface Props {
  objects: MediaObject[];
  vibe: Vibe;
  openObject: (object: MediaObject) => void;
  removeObject?: (object: MediaObject) => void;
  removePending?: boolean;
}
export type RowsProps = Omit<Props, "vibe"> & { config: Config };
