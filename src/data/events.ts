import {
  BYOB_01_GALLERY,
  type EventGalleryImage,
} from "@/data/eventGalleries";

export type StudioEvent = {
  id: string;
  title: string;
  eyebrow: string;
  date: string;
  dateTime: string;
  time: string;
  location: string;
  admission: string;
  summary: string;
  image?: string;
  video?: string;
  videoPoster?: string;
  gallery?: readonly EventGalleryImage[];
  status: "Upcoming" | "Ongoing" | "Ended";
};

function secondFriday(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, month, firstFriday + 7));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const EVENTS: StudioEvent[] = Array.from({ length: 2 }, (_, index) => {
  const monthIndex = 7 + index;
  const year = 2026 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = secondFriday(year, month).getUTCDate();
  const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const number = String(index + 1).padStart(2, "0");
  const isFirstEvent = index === 0;
  return {
    id: `byob-${number}`,
    title: `BYOB Nº ${number}`,
    eyebrow: "Monthly gathering",
    date: `${day} ${MONTHS[month]} ${year}`,
    dateTime: `${isoDate}T08:00:00`,
    time: isFirstEvent ? "8:00 AM" : "Details to come",
    location: isFirstEvent
      ? "Tibble Fork Reservoir · Up on the hill"
      : "Details to come",
    admission: "",
    summary: "Bring Your Own (Bell or bodyweight).",
    image: "/events/byob-key-art.png",
    video: isFirstEvent ? "/events/byob-01-recap.mp4?v=2" : undefined,
    videoPoster: isFirstEvent
      ? "/events/byob-01-recap-poster.webp?v=2"
      : undefined,
    gallery: isFirstEvent ? BYOB_01_GALLERY : undefined,
    status: isFirstEvent ? "Ended" : "Upcoming",
  };
});
