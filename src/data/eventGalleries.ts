export type EventGalleryImage = {
  src: `/events/${string}`;
  width: number;
  height: number;
  alt: string;
  label: "BYOB Nº 01";
  credit?: "Cody Whiting Photography";
};

const BYOB_01_LABEL = "BYOB Nº 01" as const;
const CODY_WHITING_CREDIT = "Cody Whiting Photography" as const;

function credited(
  image: Omit<EventGalleryImage, "label" | "credit">
): EventGalleryImage {
  return {
    ...image,
    label: BYOB_01_LABEL,
    credit: CODY_WHITING_CREDIT,
  };
}

export const BYOB_01_GALLERY = [
  {
    src: "/events/byob-01/gallery/01-img-8059.webp?v=1",
    width: 1102,
    height: 2000,
    alt: "The BYOB Nº 01 group gathered beneath storm clouds in the mountains.",
    label: BYOB_01_LABEL,
  },
  credited({
    src: "/events/byob-01/gallery/02-dsc04013.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "A rider on horseback greeting a BYOB Nº 01 participant.",
  }),
  credited({
    src: "/events/byob-01/gallery/03-dsc04006.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "Three BYOB Nº 01 participants walking together through the meadow.",
  }),
  credited({
    src: "/events/byob-01/gallery/04-dsc03999.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A camera operator documenting BYOB Nº 01 from the hillside.",
  }),
  credited({
    src: "/events/byob-01/gallery/05-dsc04005.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "BYOB Nº 01 participants moving through mountain sagebrush.",
  }),
  credited({
    src: "/events/byob-01/gallery/06-dsc03949.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A BYOB Nº 01 participant photographing the gathering.",
  }),
  credited({
    src: "/events/byob-01/gallery/07-dsc04014.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A horseback rider meeting a participant on the BYOB Nº 01 trail.",
  }),
  credited({
    src: "/events/byob-01/gallery/08-dsc04016.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A horseback rider crossing the BYOB Nº 01 mountain clearing.",
  }),
  credited({
    src: "/events/byob-01/gallery/09-dsc03977.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A group of BYOB Nº 01 participants walking through tall grass.",
  }),
  credited({
    src: "/events/byob-01/gallery/10-dsc03963.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "BYOB Nº 01 participants climbing a trail through the sagebrush.",
  }),
  credited({
    src: "/events/byob-01/gallery/11-dsc03907.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "A small dog resting in a carrier beneath blankets at BYOB Nº 01.",
  }),
  credited({
    src: "/events/byob-01/gallery/12-dsc03912.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "Two people reviewing camera equipment at BYOB Nº 01.",
  }),
  credited({
    src: "/events/byob-01/gallery/13-dsc03917.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A BYOB Nº 01 participant carrying a loaded barbell uphill.",
  }),
  credited({
    src: "/events/byob-01/gallery/14-dsc03928.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "The BYOB Nº 01 group spread across a mountain clearing.",
  }),
  credited({
    src: "/events/byob-01/gallery/15-dsc03925.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "A BYOB Nº 01 participant in a red cap and weighted vest.",
  }),
  credited({
    src: "/events/byob-01/gallery/16-dsc03924.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A smiling participant standing behind kettlebells at BYOB Nº 01.",
  }),
  credited({
    src: "/events/byob-01/gallery/17-dsc03884.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "Clouds moving through the forested mountains above BYOB Nº 01.",
  }),
  credited({
    src: "/events/byob-01/gallery/18-dsc03897.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A BYOB Nº 01 participant preparing equipment beside the course.",
  }),
  credited({
    src: "/events/byob-01/gallery/19-dsc04026.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "Participants in red BYOB shirts walking the mountain trail.",
  }),
  credited({
    src: "/events/byob-01/gallery/20-dsc04033.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "Two BYOB Nº 01 participants walking together through the meadow.",
  }),
  credited({
    src: "/events/byob-01/gallery/21-dsc03993.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "The BYOB Nº 01 group lunging in a mountain clearing.",
  }),
  credited({
    src: "/events/byob-01/gallery/22-dsc04024.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "BYOB Nº 01 participants following one another uphill.",
  }),
  credited({
    src: "/events/byob-01/gallery/23-dsc03954.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "BYOB Nº 01 participants gathered beside the course markers.",
  }),
  credited({
    src: "/events/byob-01/gallery/24-dsc04009.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "A horseback rider pausing with a BYOB Nº 01 participant.",
  }),
  credited({
    src: "/events/byob-01/gallery/25-dsc03996.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A horseback rider passing two BYOB Nº 01 participants.",
  }),
  credited({
    src: "/events/byob-01/gallery/26-dsc04037.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "The steep forested mountainside surrounding BYOB Nº 01.",
  }),
  credited({
    src: "/events/byob-01/gallery/27-dsc03994.webp?v=1",
    width: 2000,
    height: 1333,
    alt: "A horseback rider moving through the BYOB Nº 01 landscape.",
  }),
  credited({
    src: "/events/byob-01/gallery/28-dsc03957.webp?v=1",
    width: 1333,
    height: 2000,
    alt: "A hero sign beside the BYOB Nº 01 gathering and equipment table.",
  }),
] satisfies readonly EventGalleryImage[];
