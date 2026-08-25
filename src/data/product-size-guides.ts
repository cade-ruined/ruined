export type ProductSizeGuide = {
  fit: "Men's" | "Women's";
  label: string;
  image: {
    src: string;
    alt: string;
    width: number;
    height: number;
    cropTop: number;
  };
};

export type ProductSizeGuideConfig = {
  fitOption: string;
  sizeOption: string;
  guides: Record<string, ProductSizeGuide>;
};

const PRODUCT_SIZE_GUIDES: Record<string, ProductSizeGuideConfig> = {
  "byob-tank": {
    fitOption: "Fit",
    sizeOption: "Size",
    guides: {
      "Men's": {
        fit: "Men's",
        label: "Men's size guide",
        image: {
          src: "/store/byob-tank/size-chart-mens.webp",
          alt: "Men's BYOB Tank size chart in inches. S: body length 27 5/8, chest width 19, armhole 11 3/4. M: 28 5/8, 21, 12 1/8. L: 29 5/8, 23, 12 1/2. XL: 30 5/8, 25, 13. 2XL: 31 5/8, 27, 13 3/8.",
          width: 1750,
          height: 534,
          cropTop: 104,
        },
      },
      "Women's": {
        fit: "Women's",
        label: "Women's size guide",
        image: {
          src: "/store/byob-tank/size-chart-womens.webp",
          alt: "Women's BYOB Tank size chart in inches. XS: body length 21, chest 17 3/8. S: 21 1/2, 18 3/8. M: 22, 19 3/8. L: 22 1/2, 20 3/8. XL: 23, 21 3/8.",
          width: 1558,
          height: 594,
          cropTop: 104,
        },
      },
    },
  },
};

export function getProductSizeGuideConfig(
  productId: string
): ProductSizeGuideConfig | undefined {
  return PRODUCT_SIZE_GUIDES[productId];
}

export function getProductSizeGuide(
  productId: string,
  fit: string | undefined
): ProductSizeGuide | undefined {
  if (!fit) return undefined;
  return PRODUCT_SIZE_GUIDES[productId]?.guides[fit];
}
