/** Sample artwork and data for stories. Nothing here ships in the app. */
import appMark from "../assets/brand/app-mark.png";
import orb1 from "../assets/orbs/orb-1-44.png";
import orb2 from "../assets/orbs/orb-2-44.png";
import orb3 from "../assets/orbs/orb-3-44.png";
import orb4 from "../assets/orbs/orb-4-44.png";
import orbHome from "../assets/orbs/orb-home-48.png";
import orbSm from "../assets/orbs/orb-sm-20.png";
import orbUser from "../assets/orbs/orb-user-24.png";

import type { CategoryTableEntry } from "./CategoryTable.tsx";
import type { DonutSlice } from "./DonutChart.tsx";

export const orbs = {
  home: orbHome,
  small: orbSm,
  user: orbUser,
  a: orb1,
  b: orb2,
  c: orb3,
  d: orb4,
};
export const marks = { app: appMark };

export const spendSlices: readonly DonutSlice[] = [
  { slot: 1, label: "Rent & Housing", value: 12305.0 },
  { slot: 3, label: "Food & Drink", value: 4916.68 },
  { slot: 4, label: "Clothing & Department Stores", value: 3750.42 },
  { slot: 6, label: "Personal Payment", value: 3120.86 },
  { slot: 2, label: "Health & Wellness", value: 2171.45 },
  { slot: 5, label: "Travel", value: 1826.61 },
  { slot: 7, label: "Electronics & Software", value: 1466.22 },
  { slot: 8, label: "Everything else", value: 8160.59 },
];

export const spendRows: readonly CategoryTableEntry[] = [
  { slot: 1, label: "Rent & Housing", amount: "$12,305.00", share: "32.6%" },
  { slot: 3, label: "Food & Drink", amount: "$4,916.68", share: "13.0%" },
  { slot: 4, label: "Clothing & Department Stores", amount: "$3,750.42", share: "9.9%" },
  { slot: 6, label: "Personal Payment", amount: "$3,120.86", share: "8.3%" },
  { slot: 2, label: "Health & Wellness", amount: "$2,171.45", share: "5.8%" },
  { slot: 5, label: "Travel", amount: "$1,826.61", share: "4.8%" },
  { slot: 7, label: "Electronics & Software", amount: "$1,466.22", share: "3.7%" },
  { slot: 8, label: "Everything else", amount: "$8,160.59", share: "21.9%" },
];
