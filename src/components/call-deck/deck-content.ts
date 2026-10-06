/** Story deck revised from the final handoff; operational guidance stays in presenter notes. */
export const MEMBERSHIP_URL = "https://members.theruinedproject.com/membership";

export type Slide = {
  id: string;
  title: string;
  headline: string;
  lines?: string[];
  kind: "cover" | "statement" | "equation" | "handoff";
  room: 0 | 1 | 2 | 3 | 4;
  notes: string;
};

export type DeckChapter = {
  room: Slide["room"];
  title: string;
  location: "Lobby" | "Artifacts" | "About" | "Members" | "Community";
  /** One-based inclusive slide numbers. */
  start: number;
  end: number;
};

export const DECK_CHAPTERS: DeckChapter[] = [
  { room: 0, title: "Origins", location: "Lobby", start: 1, end: 3 },
  { room: 1, title: "Connection", location: "Artifacts", start: 4, end: 5 },
  { room: 2, title: "The room", location: "About", start: 6, end: 8 },
  { room: 3, title: "Your environment", location: "Members", start: 9, end: 11 },
  { room: 4, title: "What we built", location: "Community", start: 12, end: 12 },
];

export const DECK_SLIDES: Slide[] = [
  {
    "id": "ruined",
    "title": "RUINED",
    "headline": "RUINED",
    "kind": "cover",
    "room": 0,
    "notes": "Opening visual only. Welcome the room and frame the call. No product explanation yet.\n\nThe deck is visual storytelling behind Tyler + Mitch. Its job is to tell the story the landing page cannot tell: the life experiences, VITL culture, relationships, loss of the room, and why Ruined was created. Stop before product mechanics.\n\nThe call moves from the 12-slide story deck to the live Membership landing page, then open Q&A and an invitation to join."
  },
  {
    "id": "been-through-it",
    "title": "WE'VE ALL BEEN THROUGH SOME SHIT",
    "headline": "We’ve all been\nthrough some shit.",
    "kind": "statement",
    "room": 0,
    "notes": "Tyler + Mitch tell selected human stories: loss, suicide, murder, divorce, addiction, business struggles, starting over. Not a trauma resume. Establish that everyone eventually gets something."
  },
  {
    "id": "vitl",
    "title": "WE'VE LEARNED SOMETHING",
    "headline": "We’ve learned\nsomething.",
    "kind": "statement",
    "room": 0,
    "notes": "VITL was built to win, but something deeper emerged. People knew each other's stories. Vulnerability became culturally safe while ambition and performance remained high."
  },
  {
    "id": "connection",
    "title": "VULNERABILITY + GROWTH = CONNECTION",
    "headline": "Vulnerability\n+ Growth\n= Connection",
    "kind": "equation",
    "room": 1,
    "notes": "Hero idea. Vulnerability alone was not the magic; ambition alone was not either. People could say: this happened to me / this is where I am / this is who I'm trying to become / now let's go."
  },
  {
    "id": "lost-the-room",
    "title": "THEN WE LOST IT",
    "headline": "Then we lost it.",
    "kind": "statement",
    "room": 1,
    "notes": "When VITL disappeared, the loss was bigger than the business. The shared mission, daily interaction and container holding those relationships disappeared."
  },
  {
    "id": "wanted-it-back",
    "title": "WE WANTED THE ROOM BACK",
    "headline": "We wanted\nthe room back.",
    "kind": "statement",
    "room": 2,
    "notes": "Major hero moment. Minimal copy. This is the emotional hinge of the entire deck. Let the line breathe."
  },
  {
    "id": "what-ruined-means",
    "title": "WHAT DOES RUINED MEAN?",
    "headline": "What does\nRuined mean?",
    "kind": "statement",
    "room": 2,
    "notes": "Ruined is not staying broken or defined by trauma. The moments that threaten to ruin a life can become part of the foundation of what comes next."
  },
  {
    "id": "why-we-created-ruined",
    "title": "WHY WE CREATED RUINED",
    "headline": "Why we\ncreated Ruined.",
    "kind": "statement",
    "room": 2,
    "notes": "Build the room intentionally this time: not tied to solar, employment, one industry, one company, or one kind of person. Build it around people committed to becoming better."
  },
  {
    "id": "your-people",
    "title": "MAYBE YOU'VE FELT IT TOO",
    "headline": "Maybe you’ve\nfelt it too.",
    "kind": "statement",
    "room": 3,
    "notes": "Turn the mirror from founders to audience. Maybe they lost a room, outgrew one, never had one, or are building something the people around them don't fully understand."
  },
  {
    "id": "community-changes-us",
    "title": "COMMUNITY CHANGES US",
    "headline": "Community\nchanges us.",
    "kind": "statement",
    "room": 3,
    "notes": "Environment shapes what feels normal, possible and acceptable. The people around us influence how we think, respond, grow and act."
  },
  {
    "id": "knowing-and-changing",
    "title": "INFORMATION ISN'T THE PROBLEM",
    "headline": "Information isn’t\nthe problem.",
    "kind": "statement",
    "room": 3,
    "notes": "Books, podcasts, courses, YouTube, AI: information is everywhere. Knowing and changing are different. Application, feedback, accountability and environment are the missing pieces."
  },
  {
    "id": "built-what-we-wanted",
    "title": "SO WE BUILT WHAT WE WANTED",
    "headline": "So we built\nwhat we wanted.",
    "lines": [
      "Community.",
      "Coaching.",
      "Accountability.",
      "Real relationships.",
      "Experiences.",
      "Growth."
    ],
    "kind": "handoff",
    "room": 4,
    "notes": "Final deck slide. Community. Coaching. Accountability. Real relationships. Experiences. Growth. Then verbally transition to the actual Membership page.\n\nTHE HANDOFF\nAfter Slide 12, do not continue into another product slide. End the deck and have everyone open the actual Membership invitation page on their own device.\nMembership page: https://members.theruinedproject.com/membership\n\nSUGGESTED SPOKEN TRANSITION\n“That is really why we built this. And instead of showing you another 25 slides explaining Memberships, we want to show you the actual thing. We are dropping the Membership page in the chat. Pull it up with us. We will walk through exactly what we built, and if anything is unclear while you are looking at it, ask us.”\n\nLANDING PAGE WALKTHROUGH\nMeet Ruined / belief → Foundations → SEE / FACE / CUT / GROW → monthly rhythm → Circles → accountability → community + experiences → future opportunities to contribute/lead → expectations → Founding Members → pricing → how it starts → FAQ / open questions.\n\nDo not read the page to them. Let people scroll and experience it. Tyler + Mitch provide context, stories and clarification. Repeated questions are landing-page research.\n\nLEADERSHIP CONTEXT\nThe previous formal leadership ladder is no longer current. Simply explain that future opportunities to contribute and lead will emerge as Ruined grows, and the community will help shape what that becomes.\n\nFIRST-CALL RUN OF SHOW\n0–3 min — Camera / Slide 1. Welcome. Explain this is a conversation, not a giant sales presentation.\n3–15 min — Slides 2–12. Origin story. VITL. Vulnerability + growth. Losing the room. Why Ruined. Why environment matters.\n15–35 min — Live landing page. Everyone opens the page. Walk through the actual Membership experience together.\n35–55 min — Open Q&A. Answer questions. Track every repeated question as product/landing-page feedback.\n55–60 min — Invitation. Simple invitation to register from the page already open in front of them.\n\nThe deck creates the feeling. The landing page proves the substance."
  }
];
