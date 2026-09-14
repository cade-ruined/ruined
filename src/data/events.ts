import {
  BYOB_01_GALLERY,
  type EventGalleryImage,
} from "@/data/eventGalleries";
import { BYOB_02_EVENT_KEY } from "@/lib/events/byob-registration-model";

export type EventRegistration = {
  href: string;
  label: string;
  status: "Open" | "Closed";
};

export type StudioEvent = {
  id: string;
  title: string;
  eyebrow: string;
  date: string;
  /** Absolute RFC 3339 instant. Timed events must include Z or a UTC offset. */
  dateTime: string;
  time: string;
  location: string;
  admission: string;
  summary: string;
  timezone: string;
  image?: string;
  video?: string;
  videoPoster?: string;
  gallery?: readonly EventGalleryImage[];
  registration?: EventRegistration;
  status: "Upcoming" | "Ongoing" | "Ended";
};

function secondFriday(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, month, firstFriday + 7));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BYOB_01_FEATURE_IMAGE = BYOB_01_GALLERY[0]?.src ?? "/events/byob-key-art.png";

export const EVENTS: StudioEvent[] = Array.from({ length: 2 }, (_, index) => {
  const monthIndex = 7 + index;
  const year = 2026 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = secondFriday(year, month).getUTCDate();
  const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const number = String(index + 1).padStart(2, "0");
  const isFirstEvent = index === 0;
  const id = `byob-${number}`;
  const isRegistrationEvent = id === BYOB_02_EVENT_KEY;
  return {
    id,
    title: `BYOB Nº ${number}`,
    eyebrow: "Monthly gathering",
    date: `${day} ${MONTHS[month]} ${year}`,
    dateTime: isFirstEvent || isRegistrationEvent
      ? `${isoDate}T14:00:00.000Z`
      : `${isoDate}T18:00:00.000Z`,
    time: isFirstEvent
      ? "8:00 AM"
      : isRegistrationEvent
        ? "8:00 AM MDT"
        : "Details to come",
    location: isFirstEvent
      ? "Tibble Fork Reservoir · Up on the hill"
      : isRegistrationEvent
        ? "Tibble Fork Reservoir · Hill south of the parking lot"
        : "Details to come",
    admission: "",
    summary: "Bring Your Own (Bell or bodyweight).",
    timezone: "America/Denver",
    image: isFirstEvent ? BYOB_01_FEATURE_IMAGE : "/events/byob-key-art.png",
    video: isFirstEvent ? "/events/byob-01-recap.mp4?v=2" : undefined,
    videoPoster: isFirstEvent
      ? "/events/byob-01-recap-poster.webp?v=2"
      : undefined,
    gallery: isFirstEvent ? BYOB_01_GALLERY : undefined,
    registration: isRegistrationEvent
      ? {
          href: "/community/byob-02/register",
          label: "Register",
          status: "Open",
        }
      : undefined,
    status: isFirstEvent ? "Ended" : "Upcoming",
  };
});
