import {
  BYOB_01_GALLERY,
  type EventGalleryImage,
} from "@/data/eventGalleries";

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
  /** The instant is only a date boundary for sorting; no start time is announced. */
  dateOnly?: boolean;
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

export const EVENTS: StudioEvent[] = Array.from({ length: 4 }, (_, index) => {
  const monthIndex = 7 + index;
  const year = 2026 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  // The November gathering moves to Saturday, November 14.
  const day = secondFriday(year, month).getUTCDate() + (index === 3 ? 1 : 0);
  const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const number = String(index + 1).padStart(2, "0");
  const isFirstEvent = index === 0;
  const id = `byob-${number}`;
  const recapNumber = index === 1 || index === 2 ? number : null;
  const isRegistrationEvent = index === 1 || index === 2;
  const isNovemberEvent = index === 3;
  return {
    id,
    title: `BYOB Nº ${number}`,
    eyebrow: "Monthly gathering",
    date: `${day} ${MONTHS[month]} ${year}`,
    // November 14 at 9 AM Mountain Standard Time is 16:00 UTC.
    dateTime: isNovemberEvent ? `${isoDate}T16:00:00.000Z` : `${isoDate}T14:00:00.000Z`,
    time: isFirstEvent
      ? "8:00 AM"
      : isRegistrationEvent
        ? "8:00 AM MDT"
        : "9:00 AM MST",
    location: isFirstEvent
      ? "Tibble Fork Reservoir · Up on the hill"
      : isRegistrationEvent
        ? "Tibble Fork Reservoir · Hill south of the parking lot"
        : "Details to come",
    admission: "",
    summary: isNovemberEvent
      ? "Bring Your Own (Bell or bodyweight). Location and registration details coming soon."
      : "Bring Your Own (Bell or bodyweight).",
    timezone: "America/Denver",
    image: isFirstEvent
      ? BYOB_01_FEATURE_IMAGE
      : recapNumber ? `/events/byob-${recapNumber}-recap-poster.webp` : "/events/byob-key-art.png",
    video: isFirstEvent ? "/events/byob-01-recap.mp4?v=2" : recapNumber ? `/events/byob-${recapNumber}-recap.mp4` : undefined,
    videoPoster: isFirstEvent
      ? "/events/byob-01-recap-poster.webp?v=2"
      : recapNumber ? `/events/byob-${recapNumber}-recap-poster.webp` : undefined,
    gallery: isFirstEvent ? BYOB_01_GALLERY : undefined,
    registration: isRegistrationEvent
      ? {
          href: `/community/${id}/register`,
          label: "Register",
          status: "Closed",
        }
      : undefined,
    status: index < 3 ? "Ended" : "Upcoming",
  };
});
