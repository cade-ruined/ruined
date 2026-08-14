export type StudioEvent = { id: string; title: string; eyebrow: string; date: string; dateTime: string; time: string; location: string; admission: string; summary: string; image?: string; status: "Upcoming" | "Ongoing" | "Archive" };

function secondFriday(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, month, firstFriday + 7));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const EVENTS: StudioEvent[] = Array.from({ length: 12 }, (_, index) => {
  const monthIndex = 7 + index;
  const year = 2026 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = secondFriday(year, month).getUTCDate();
  const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `byob-${number}`,
    title: `BYOB Nº ${number}`,
    eyebrow: "Monthly gathering",
    date: `${day} ${MONTHS[month]} ${year}`,
    dateTime: `${isoDate}T08:00:00`,
    time: "8:00 AM",
    location: "Tibble Fork Reservoir · Up on the hill",
    admission: "",
    summary: "Bring Your Own (Bell or bodyweight).",
    image: "/events/byob-key-art.png",
    status: "Upcoming",
  };
});
