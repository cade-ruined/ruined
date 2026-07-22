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
  image: string;
  status: "Upcoming" | "Ongoing" | "Archive";
};

// Editorial seed programme. Keep programming in one place so confirmed dates,
// ticket states, and imagery can be updated without touching the page layouts.
export const EVENTS: StudioEvent[] = [
  {
    id: "open-studio-01",
    title: "Open Studio Nº 01",
    eyebrow: "Open studio",
    date: "12 September 2026",
    dateTime: "2026-09-12T18:00:00-06:00",
    time: "18:00—21:00",
    location: "Studio No. 17 · Utah",
    admission: "RSVP",
    summary:
      "An evening inside the workshop: Drop 01, current material studies, and the objects that did not make the final edit.",
    image: "/art/loft.jpg",
    status: "Upcoming",
  },
  {
    id: "after-hours-material-memory",
    title: "After Hours: Material Memory",
    eyebrow: "Conversation",
    date: "03 October 2026",
    dateTime: "2026-10-03T19:00:00-06:00",
    time: "19:00—20:30",
    location: "The Record Room · Studio No. 17",
    admission: "Limited capacity",
    summary:
      "A conversation on patina, repair, and why the studio begins with what has already been used.",
    image: "/art/records.jpg",
    status: "Upcoming",
  },
  {
    id: "fireside-session-01",
    title: "Fireside Session Nº 01",
    eyebrow: "Listening session",
    date: "07 November 2026",
    dateTime: "2026-11-07T20:00:00-07:00",
    time: "20:00—Late",
    location: "The Lounge · Studio No. 17",
    admission: "Invitation / waitlist",
    summary:
      "A low-light listening room with a guest selector, small editions, and no stage.",
    image: "/art/lounge.jpg",
    status: "Upcoming",
  },
  {
    id: "drop-01-viewing-window",
    title: "Drop 01 / Viewing Window",
    eyebrow: "Installation",
    date: "Spring—Summer 2026",
    dateTime: "2026-06-01",
    time: "By appointment",
    location: "Studio No. 17 · Utah",
    admission: "Open by request",
    summary:
      "The first four artifacts shown in the room where they were developed, alongside samples and production notes.",
    image: "/art/store.jpg",
    status: "Ongoing",
  },
];
