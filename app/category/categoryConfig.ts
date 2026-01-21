export const CATEGORY_CONFIG = {
  fruits: {
    label: "Fruits",
    icon: "apple",
    color: "#FF6B6B",
  },
  vegetables: {
    label: "Vegetables",
    icon: "leaf",
    color: "#51CF66",
  },
  dairy: {
    label: "Dairy",
    icon: "cow",
    color: "#FFD43B",
  },
  snacks: {
    label: "Snacks",
    icon: "cookie",
    color: "#845EF7",
  },
  beverages: {
    label: "Beverages",
    icon: "cup",
    color: "#339AF0",
  },
  staples: {
    label: "Staples",
    icon: "sack",
    color: "#FAB005",
  },
  personal_care: {
    label: "Personal Care",
    icon: "face-woman-shimmer",
    color: "#E599F7",
  },
  household: {
    label: "Household",
    icon: "home-outline",
    color: "#74C0FC",
  },
} as const;

export type CategoryKey = keyof typeof CATEGORY_CONFIG;
