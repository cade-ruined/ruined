/** Audience copy is intentionally sparse; notes retain the supplied outline verbatim. */
export type Slide = {
  id: string;
  title: string;
  headline: string;
  eyebrow?: string;
  body?: string;
  lines?: string[];
  items?: { label: string; detail: string }[];
  kind:
    | "cover"
    | "statement"
    | "equation"
    | "list"
    | "framework"
    | "month"
    | "circle"
    | "path"
    | "stack"
    | "price"
    | "steps"
    | "close";
  room: 0 | 1 | 2 | 3 | 4;
  notes: string;
  price?: {
    regular: string;
    founding: string;
    cadence: string;
    audience: string;
    terms: string;
    pending?: string;
  };
  prompt?: string;
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
  { room: 0, title: "Origins", location: "Lobby", start: 1, end: 9 },
  { room: 1, title: "The reason", location: "Artifacts", start: 10, end: 17 },
  { room: 2, title: "The experience", location: "About", start: 18, end: 26 },
  { room: 3, title: "The people", location: "Members", start: 27, end: 34 },
  { room: 4, title: "Your next chapter", location: "Community", start: 35, end: 39 },
];

export const DECK_SLIDES: Slide[] = [
  {
    "id": "ruined",
    "headline": "RUINED",
    "kind": "cover",
    "title": "RUINED",
    "room": 0,
    "notes": "Cover only. No tagline and no explanation. Cade creates a striking Ruined visual. Tyler begins speaking over the image\nrather than asking the slide to explain the brand."
  },
  {
    "id": "been-through-it",
    "headline": "We’ve all been\nthrough some shit.",
    "kind": "statement",
    "title": "WE'VE ALL BEEN THROUGH SOME SHIT",
    "room": 0,
    "notes": "This is the human origin of Ruined. Tyler and Mitch share pieces of the difficult experiences they have personally lived\nthrough or experienced alongside people they love: death, suicide, murder, divorce, betrayal, addiction, business\nstruggles, financial uncertainty, identity changes and starting over.\nDo not present this as a trauma resume or a competition over suffering. The point is that everyone eventually has a story.\nSome experiences happen to us. Some come from choices we make. Some nearly destroy us. Some change us.\nSometimes the things we are convinced will ruin our lives eventually become part of what shapes us."
  },
  {
    "id": "vitl",
    "eyebrow": "VITL",
    "headline": "They knew\neach other’s stories.",
    "body": "Honesty. Ambition. Growth.",
    "kind": "statement",
    "title": "WE LEARNED SOMETHING AT VITL",
    "room": 0,
    "notes": "VITL began as a sales company, but something much more meaningful developed inside it.\nPeople became incredibly close - not simply because they worked together, but because they knew each other's stories.\nThe culture became vulnerable enough that people talked honestly about what they had been through, what they were\nstruggling with and what they were trying to become.\nAt the same time, the culture still expected people to show up, perform, grow, fight and win. Vulnerability did not replace\nambition. It deepened the relationships between ambitious people."
  },
  {
    "id": "connection",
    "headline": "Vulnerability\n+ Growth\n= Connection",
    "lines": [
      "This happened to me.",
      "This is where I am.",
      "This is who I am trying to become.",
      "Now let’s go."
    ],
    "kind": "equation",
    "title": "VULNERABILITY + GROWTH = CONNECTION",
    "room": 0,
    "notes": "Potential hero visual: VULNERABILITY x GROWTH = CONNECTION\nThe community was not built around sitting in pain. It was built around being honest about it and then moving forward\ntogether.\nThis happened to me.\nThis is where I am.\nThis is who I am trying to become.\nNow let's go.\nPeople knew each other's pain and each other's potential. They pushed one another, held each other accountable,\ncelebrated wins, showed up during difficult periods and fought to become better together.\nThe bonds became different because of it."
  },
  {
    "id": "lost-the-room",
    "headline": "We lost\nthat room.",
    "body": "The shared mission disappeared. People scattered.",
    "kind": "statement",
    "title": "THEN WE LOST IT",
    "room": 0,
    "notes": "When VITL disappeared, Tyler and Mitch did not simply lose a business.\nThey lost that room.\nThe shared mission disappeared. People scattered. Regular interaction disappeared. Roles changed. The container that\nhad held those relationships was suddenly gone.\nLosing it made the value of what had existed much easier to see: the community itself had become one of the most\nmeaningful things the business created."
  },
  {
    "id": "wanted-it-back",
    "headline": "We wanted\nthat back.",
    "body": "An intentional community, independent of a sales company.",
    "kind": "statement",
    "title": "WE WANTED THAT BACK",
    "room": 0,
    "notes": "But this time, the goal was to build it intentionally and make it independent of a sales company.\nNot dependent on employment.\nNot dependent on everyone selling the same product.\nNot limited to salespeople.\nNot dependent on whether a company survives.\nA community where people can be honest about what they have been through while being surrounded by\npeople committed to becoming better because of it."
  },
  {
    "id": "what-ruined-means",
    "headline": "What threatens to ruin you\ncan become a foundation.",
    "body": "Some things happen to us. Some are choices we make.",
    "kind": "statement",
    "title": "WHAT DOES \"RUINED\" MEAN?",
    "room": 0,
    "notes": "Ruined does not mean broken, and it is not about staying defined by trauma.\nIt represents the moments, experiences and decisions that threaten to ruin everything: loss, divorce, failure, bankruptcy,\nchanging beliefs, leaving something, starting over, taking a risk or choosing a path other people do not understand.\nSome happen to us. Some are choices we make.\nThe moments that threaten to ruin your life often become the foundation of the life you're meant to build.\nThe question becomes: What do you see differently? What do you face? What do you leave behind? Who do you\nbecome because of it? This quietly introduces the logic behind SEE / FACE / CUT / GROW without teaching the\nframework yet."
  },
  {
    "id": "why-we-created-ruined",
    "headline": "Your people shouldn’t depend\non where you work.",
    "body": "People from different walks of life, committed to becoming better.",
    "kind": "statement",
    "title": "WHY WE CREATED RUINED",
    "room": 0,
    "notes": "The realization was that this kind of community should not require working at the right company.\nThere are entrepreneurs, athletes, artists, parents, leaders, creators and people from completely different walks of life\nwho want the same thing.\nPeople who have been through things.\nPeople currently going through things.\nPeople taking risks others do not understand.\nPeople who want to grow.\nPeople who want meaningful relationships.\nPeople looking for more of their people.\nSo instead of waiting to find that community, Ruined was created to intentionally build it."
  },
  {
    "id": "what-is-ruined",
    "headline": "A community.\nA lifestyle.",
    "lines": [
      "Community",
      "Events",
      "Education",
      "Media",
      "Apparel"
    ],
    "body": "Ruined Memberships is where the community and personal development live.",
    "kind": "list",
    "title": "WHAT IS RUINED?",
    "room": 0,
    "notes": "RUINED is a community and lifestyle brand built around that belief.\nCommunity | Events | Education | Media | Apparel\nThen narrow the conversation: Ruined Memberships is where the community and personal-development side of\nthat philosophy lives."
  },
  {
    "id": "your-people",
    "headline": "Where are\nyour people?",
    "body": "Maybe you’ve outgrown a room. Lost one. Never had one.",
    "prompt": "What kind of room are you looking for?",
    "kind": "statement",
    "title": "MAYBE YOU'VE FELT IT TOO",
    "room": 1,
    "notes": "Only now does the presentation turn toward the prospect.\nMaybe you have outgrown a room. Maybe you have lost one. Maybe you have never had one. Maybe the people around\nyou love you but are not necessarily trying to grow in the same ways you are. Maybe something happened that changed\nyou. Maybe you are building something other people do not understand.\nMaybe you simply want more relationships with people who are willing to talk about the real shit and still expect you to\nshow up.\nWhere are your people?"
  },
  {
    "id": "community-changes-us",
    "headline": "The people around you\nchange what feels possible.",
    "lines": [
      "Challenge.",
      "Support.",
      "Expectation."
    ],
    "kind": "statement",
    "title": "COMMUNITY CHANGES US",
    "room": 1,
    "notes": "Who we are surrounded by matters. The people around us influence what feels normal, what feels possible, what we\ntolerate, what we pursue, how we think and how we respond when life gets difficult.\nYou do not need everyone around you to think like you. But people who challenge you, support you and expect\nsomething from you can materially change your environment."
  },
  {
    "id": "knowing-and-changing",
    "headline": "Knowing and changing\nare not the same thing.",
    "lines": [
      "Conversation",
      "Application",
      "Feedback",
      "Accountability"
    ],
    "kind": "statement",
    "title": "INFORMATION ISN'T THE PROBLEM",
    "room": 1,
    "notes": "There has never been more information about relationships, business, health, leadership, mindset, money, purpose and\npersonal development.\nKnowing and changing are not the same thing.\nThis creates the case for coaching, conversation, application, feedback and accountability."
  },
  {
    "id": "invest-in-yourself",
    "headline": "Become intentional\nabout who you’re becoming.",
    "body": "How you think. Decide. Communicate. Lead.",
    "kind": "statement",
    "title": "WHY INVEST IN YOURSELF?",
    "room": 1,
    "notes": "People invest constantly in things they hope improve their lives: businesses, education, homes, experiences, health and\nequipment.\nNearly every outcome still runs through how we think, decide, communicate, lead, respond to adversity and choose the\npeople around us.\nPersonal development is not endless optimization. It is becoming more intentional about who you are becoming."
  },
  {
    "id": "built-what-we-wanted",
    "headline": "So we built it.",
    "eyebrow": "RUINED MEMBERSHIPS",
    "lines": [
      "Community + coaching",
      "Accountability + perspective",
      "Real relationships + experiences",
      "Growth + leadership"
    ],
    "kind": "list",
    "title": "SO WE BUILT WHAT WE WANTED",
    "room": 1,
    "notes": "Bring the opening argument together.\nWe wanted community.\nWe wanted coaching.\nWe wanted accountability.\nWe wanted different perspectives.\nWe wanted real relationships.\nWe wanted experiences outside a Zoom screen.\nWe wanted growth that was not limited to business or money.\nWe wanted somewhere people could eventually become leaders themselves.\nSo we built it: RUINED MEMBERSHIPS."
  },
  {
    "id": "memberships",
    "headline": "Intentional growth.\nMeaningful relationships.",
    "body": "A community for becoming what’s next.",
    "lines": [
      "Community",
      "Coaching",
      "Accountability",
      "Personal development",
      "Leadership development"
    ],
    "kind": "list",
    "title": "WHAT ARE RUINED MEMBERSHIPS?",
    "room": 1,
    "notes": "A community built around intentional growth, meaningful relationships and becoming what's next.\nPart community. Part coaching. Part accountability. Part personal development. Part leadership development."
  },
  {
    "id": "what-ruined-is-not",
    "headline": "No single community\nis right for everyone.",
    "items": [
      {
        "label": "Beyond business",
        "detail": "Growth is not limited to business or money."
      },
      {
        "label": "Beyond motivation",
        "detail": "Participation, application and accountability."
      },
      {
        "label": "Beyond one person",
        "detail": "A community, not a guru."
      }
    ],
    "body": "Open to people from different walks of life.",
    "kind": "list",
    "title": "WHAT RUINED IS NOT / WHAT ELSE EXISTS",
    "room": 1,
    "notes": "Acknowledge the existing landscape: masterminds, men's and women's groups, networking groups, coaching programs\nand business communities. The point is not that these should not exist. More aligned communities should exist because\nno single community is right for everyone.\nRuined is not only a business mastermind, not a motivational seminar, not exclusively for men, not built around a guru,\nand not designed for passive consumption."
  },
  {
    "id": "what-makes-this-different",
    "headline": "Built to become\nmore than a room.",
    "items": [
      {
        "label": "Philosophy",
        "detail": "A shared way of seeing adversity and becoming."
      },
      {
        "label": "Community",
        "detail": "Real relationships."
      },
      {
        "label": "Structure",
        "detail": "Foundations, development, Circles and leadership."
      },
      {
        "label": "Experiences",
        "detail": "Online and in the real world."
      },
      {
        "label": "Progression",
        "detail": "A path to contribute and lead."
      }
    ],
    "kind": "list",
    "title": "WHAT MAKES THIS DIFFERENT",
    "room": 1,
    "notes": "Use a simple visual system around five ideas:\nPHILOSOPHY - a shared way of looking at adversity, fear and becoming.\nCOMMUNITY - real relationships, not just content consumption.\nSTRUCTURE - Foundations, ongoing development, Circles and leadership.\nEXPERIENCES - online and real-world events and experiences.\nPROGRESSION - a path to contribute, lead and help shape the community."
  },
  {
    "id": "foundations",
    "headline": "Start with\nFoundations.",
    "body": "Four sessions. A shared philosophy, language and personal framework.",
    "kind": "statement",
    "title": "YOUR FIRST STEP: FOUNDATIONS",
    "room": 2,
    "notes": "Every member begins with Foundations: four sessions that establish the philosophy, language and personal framework\nbehind Ruined.\nMembers examine where they have been, what has shaped them, what meaning they assigned to it, what they may be\navoiding and who they are becoming next."
  },
  {
    "id": "foundations-experience",
    "headline": "4 sessions.\n90 minutes each.",
    "items": [
      {
        "label": "Ruined Timeline",
        "detail": "Revisit defining events and the meaning attached to them."
      },
      {
        "label": "Letter to Your Future Self",
        "detail": "Create intention around who you’re becoming."
      },
      {
        "label": "Guided exercises",
        "detail": "Put the Ruined framework into practice."
      }
    ],
    "body": "Founders participate and share personal stories.",
    "kind": "list",
    "title": "THE FOUNDATIONS EXPERIENCE",
    "room": 2,
    "notes": "4 sessions | 90 minutes each\nFounders participate and rotate personal stories. Exercises include the Ruined Timeline, where members revisit\ndefining events and the meaning attached to them, and the Letter to Your Future Self, which creates intentionality\naround who they are becoming. Additional guided exercises reinforce the Ruined framework."
  },
  {
    "id": "after-foundations",
    "headline": "Foundations\nis the beginning.",
    "lines": [
      "Teaching + conversation",
      "Application + accountability",
      "Circles + relationships",
      "Experiences + leadership"
    ],
    "kind": "list",
    "title": "AFTER FOUNDATIONS",
    "room": 2,
    "notes": "Foundations is not the course. It is the beginning.\nAfter Foundations, membership moves into an ongoing rhythm of teaching, conversation, application, accountability,\nCircles, events, relationships and leadership."
  },
  {
    "id": "see-face-cut-grow",
    "headline": "SEE / FACE / CUT / GROW",
    "items": [
      {
        "label": "SEE",
        "detail": "Become aware of what is actually happening."
      },
      {
        "label": "FACE",
        "detail": "Stop avoiding what needs to be confronted."
      },
      {
        "label": "CUT",
        "detail": "Remove what can no longer come with you."
      },
      {
        "label": "GROW",
        "detail": "Intentionally build what comes next."
      }
    ],
    "kind": "framework",
    "title": "SEE / FACE / CUT / GROW",
    "room": 2,
    "notes": "SEE - become aware of what is actually happening.\nFACE - stop avoiding what needs to be confronted.\nCUT - remove what can no longer come with you.\nGROW - intentionally build what comes next.\nThis framework becomes the backbone of ongoing curriculum and discussion."
  },
  {
    "id": "ongoing-topics",
    "headline": "The work touches\nyour whole life.",
    "eyebrow": "POTENTIAL TOPICS",
    "lines": [
      "Identity",
      "Relationships",
      "Fear",
      "Discipline",
      "Leadership",
      "Purpose",
      "Communication",
      "Health",
      "Money",
      "Career",
      "Failure",
      "Boundaries",
      "Habits",
      "Self-awareness",
      "Accountability",
      "Meaning",
      "Decision-making"
    ],
    "body": "Through SEE / FACE / CUT / GROW.",
    "kind": "list",
    "title": "ONGOING TOPICS",
    "room": 2,
    "notes": "Potential topics include identity, relationships, fear, discipline, leadership, purpose, communication, health, money,\ncareer, failure, boundaries, habits, self-awareness, accountability, meaning and decision-making - all viewed through\nSEE / FACE / CUT / GROW."
  },
  {
    "id": "a-month-in-ruined",
    "headline": "A rhythm\nfor the work.",
    "items": [
      {
        "label": "Every week",
        "detail": "90-minute community / coaching call."
      },
      {
        "label": "Twice a month",
        "detail": "Circle meetings."
      },
      {
        "label": "Ongoing",
        "detail": "Community interaction and accountability."
      },
      {
        "label": "Throughout the year",
        "detail": "Events, experiences, workshops and opportunities."
      }
    ],
    "kind": "month",
    "title": "WHAT A MONTH LOOKS LIKE",
    "room": 2,
    "notes": "Make the experience tangible with a sample month.\nEvery week: 90-minute Ruined community/coaching call.\nTwice per month: Circle meetings.\nOngoing: community interaction and accountability.\nThroughout the year: Ruined events, experiences, workshops and opportunities."
  },
  {
    "id": "circles",
    "headline": "Small enough\nto know your name.",
    "eyebrow": "CIRCLES · APPROXIMATELY 10 PEOPLE",
    "body": "Two meetings each month.",
    "items": [
      {
        "label": "The why",
        "detail": "Go deeper into the month’s topic."
      },
      {
        "label": "The how",
        "detail": "Implementation and accountability."
      }
    ],
    "kind": "circle",
    "title": "CIRCLES",
    "room": 2,
    "notes": "Big enough to expand your world. Small enough to know your name.\nMembers are placed into Circles of approximately 10 people. Circles meet twice each month: one meeting centered\naround the deeper WHY behind the month's topic and another around implementation and accountability. Circles make\nthe larger community personal."
  },
  {
    "id": "accountability",
    "headline": "What are you\ndoing differently?",
    "body": "Because of what you’re learning.",
    "lines": [
      "Commit",
      "Act",
      "Reflect",
      "Receive feedback",
      "Be accountable"
    ],
    "prompt": "What commitment would make a difference right now?",
    "kind": "path",
    "title": "ACCOUNTABILITY",
    "room": 2,
    "notes": "Insight without action changes very little. Ruined should create repeated cycles of commitment, action, reflection,\nfeedback and accountability.\nInclude the optional one-year accountability pairing if retained in the final membership design.\nCore question: What are you doing differently because of what you are learning?"
  },
  {
    "id": "beyond-the-screen",
    "headline": "Life happens\nbeyond the screen.",
    "lines": [
      "Community gatherings, including BYOB",
      "Workshops",
      "Events + real-world experiences"
    ],
    "body": "Connection to the broader Ruined community.",
    "kind": "list",
    "title": "COMMUNITY / EVENTS / REAL-WORLD EXPERIENCES",
    "room": 2,
    "notes": "Membership should not live entirely on a screen. Explain the role of broader Ruined community experiences, free\ngatherings such as BYOB, workshops, larger events and future experiences. Clarify specific member access or benefits\nonly where finalized."
  },
  {
    "id": "leadership-philosophy",
    "headline": "The community is built\nby the people in it.",
    "body": "Leadership is a path you can choose as you contribute, embody the values and help others grow.",
    "kind": "statement",
    "title": "LEADERSHIP PHILOSOPHY",
    "room": 3,
    "notes": "This community is not supposed to be built only by the founders.\nMembers do not have to become leaders. But people who consistently contribute, embody the values and help others\ngrow can earn greater responsibility inside Ruined."
  },
  {
    "id": "leadership-path",
    "headline": "A path to\ngreater responsibility.",
    "items": [
      {
        "label": "Member",
        "detail": "Participate and grow."
      },
      {
        "label": "Shaper",
        "detail": "Contribute to the experience of others."
      },
      {
        "label": "Builder",
        "detail": "Take meaningful responsibility."
      },
      {
        "label": "Author",
        "detail": "Help lead, teach and shape Ruined."
      },
      {
        "label": "Partner",
        "detail": "Invitation-only stewardship."
      }
    ],
    "kind": "path",
    "title": "THE LEADERSHIP PATH",
    "room": 3,
    "notes": "MEMBER -> SHAPER -> BUILDER -> AUTHOR -> PARTNER\nMember: participate and grow.\nShaper: begin contributing to the experience of others.\nBuilder: take meaningful responsibility within the community.\nAuthor: help lead, teach and shape Ruined.\nPartner: invitation-only stewardship at the highest level."
  },
  {
    "id": "leadership-is-earned",
    "headline": "Leadership\nis earned.",
    "lines": [
      "Participation",
      "Character",
      "Consistency",
      "Contribution",
      "Trust"
    ],
    "body": "More responsibility for the people around you.",
    "kind": "list",
    "title": "LEADERSHIP IS EARNED",
    "room": 3,
    "notes": "Leadership is not purchased and is not based on follower count or business success alone. It comes from participation,\ncharacter, consistency, contribution, trust and living the community values.\nThe higher you progress, the more responsibility you carry for the people around you."
  },
  {
    "id": "leadership-opportunities",
    "headline": "Help others grow.\nDevelop as a leader.",
    "eyebrow": "OPPORTUNITIES",
    "lines": [
      "Lead Circles",
      "Facilitate conversations",
      "Mentor others",
      "Teach",
      "Contribute ideas",
      "Create experiences"
    ],
    "kind": "list",
    "title": "LEADERSHIP OPPORTUNITIES + BENEFITS",
    "room": 3,
    "notes": "Leadership can create opportunities to lead Circles, facilitate conversations, mentor others, teach, contribute ideas, help\ncreate experiences and develop as a leader. Finalize any additional academy, event or membership privileges before\npresenting them as guaranteed benefits."
  },
  {
    "id": "everything-included",
    "headline": "The membership.",
    "items": [
      {
        "label": "Foundations",
        "detail": "Four-session onboarding experience."
      },
      {
        "label": "Weekly community calls",
        "detail": "Ongoing coaching and development."
      },
      {
        "label": "Circles",
        "detail": "Small groups, twice monthly."
      },
      {
        "label": "Accountability",
        "detail": "Turn learning into action."
      },
      {
        "label": "Ongoing curriculum",
        "detail": "SEE / FACE / CUT / GROW."
      },
      {
        "label": "Community",
        "detail": "The broader Ruined member network."
      },
      {
        "label": "Leadership path",
        "detail": "Member through Partner."
      },
      {
        "label": "Events + experiences",
        "detail": "Connection to the broader ecosystem."
      },
      {
        "label": "Academies",
        "detail": "50% member discount."
      }
    ],
    "kind": "stack",
    "title": "EVERYTHING INCLUDED",
    "room": 3,
    "notes": "Present the complete membership stack in one clear visual:\nFoundations - four-session onboarding experience.\nWeekly Community Calls - ongoing coaching and development.\nCircles - small groups meeting twice monthly.\nAccountability - structures that turn learning into action.\nOngoing Curriculum - SEE / FACE / CUT / GROW.\nCommunity - broader Ruined member network.\nLeadership Path - Member through Partner.\nEvents + Experiences - member connection to the broader ecosystem.\nAcademies - 50% member discount."
  },
  {
    "id": "community-standards",
    "headline": "We expect\nhonesty.",
    "body": "Show up. Participate. Do the work.",
    "lines": [
      "Tell the truth.",
      "Respect confidentiality.",
      "Support other members.",
      "Accept accountability.",
      "No prospecting for customers."
    ],
    "kind": "list",
    "title": "EXPECTATIONS / COMMUNITY STANDARDS",
    "room": 3,
    "notes": "Ruined is not for spectators.\nExpect members to show up, participate, tell the truth, respect confidentiality, do the work, support other members,\naccept accountability and avoid using the community as a hunting ground for customers.\nWe do not expect perfection. We expect honesty."
  },
  {
    "id": "who-its-not-for",
    "headline": "You still have\nto do the work.",
    "body": "The room, relationships and structure require your participation.",
    "lines": [
      "More than a motivational hit.",
      "More than business networking.",
      "A willingness to be challenged."
    ],
    "kind": "statement",
    "title": "WHO IT'S NOT FOR",
    "room": 3,
    "notes": "Ruined may not fit someone looking only for a motivational hit, business networking, access without participation, a room\nwhere they are never challenged, or someone who wants another person to fix their life.\nThe community can provide the room, relationships and structure. Members still have to do the work."
  },
  {
    "id": "one-year-from-now",
    "headline": "One year\nfrom now.",
    "lines": [
      "Weekly conversations",
      "24 Circle meetings",
      "New relationships + perspectives",
      "Accountability + experiences",
      "Opportunities to lead"
    ],
    "prompt": "Who could you become in that environment?",
    "kind": "list",
    "title": "ONE YEAR FROM NOW",
    "room": 3,
    "notes": "Slow the pitch down before pricing. Invite people to imagine a year surrounded by people committed to becoming better:\nweekly conversations, 24 Circle meetings, new relationships, new perspectives, difficult conversations, accountability,\nexperiences and opportunities to lead.\nWho could you become in that environment?"
  },
  {
    "id": "founding-fifty",
    "headline": "The founding 50.",
    "body": "Help establish the original culture and membership cohort.",
    "lines": [
      "The first 50 members.",
      "Founding pricing."
    ],
    "kind": "statement",
    "title": "THE FOUNDING 50",
    "room": 4,
    "notes": "The first 50 members are not simply joining an established program. They are helping establish the original culture and\nmembership cohort. They are taking an early chance on Ruined and receive founding pricing in return. Keep scarcity\nfactual and simple."
  },
  {
    "id": "individual-pricing",
    "headline": "Individual\nmembership.",
    "price": {
      "regular": "$499",
      "founding": "$349",
      "cadence": "/ month",
      "audience": "First 50 members only.",
      "terms": "Locked in for life while membership remains continuously active."
    },
    "kind": "price",
    "title": "INDIVIDUAL PRICING",
    "room": 4,
    "notes": "Regular Membership: $499\nFounding Member: $349\nFirst 50 members only.\n$349 locked in for life as long as the membership remains continuously active. Confirm final billing cadence and exact\nlock-in terms before the live pitch.\n\nConfirmed for this deck: All prices are monthly. The $349 founding individual rate is locked in for life while membership remains continuously active."
  },
  {
    "id": "couple-pricing",
    "headline": "Couple\nmembership.",
    "price": {
      "regular": "$700",
      "founding": "$600",
      "cadence": "/ month",
      "audience": "Combined membership for two.",
      "terms": "Locked in for life while both memberships remain continuously active."
    },
    "kind": "price",
    "title": "COUPLE PRICING",
    "room": 4,
    "notes": "Regular combined membership: $700\nFounding Couple Membership: $600\nBefore finalizing the deck, decide whether the $600 couple rate is also locked in for life and whether both members must\nremain active together to preserve that rate.\n\nConfirmed for this deck: All prices are monthly. The $600 founding couple rate is locked in for life while both memberships remain continuously active."
  },
  {
    "id": "what-happens-next",
    "headline": "Your next\nchapter.",
    "items": [
      {
        "label": "Join",
        "detail": "Complete registration."
      },
      {
        "label": "Build your profile",
        "detail": "Introduce yourself to the community."
      },
      {
        "label": "Start Foundations",
        "detail": "Begin the four-session experience."
      },
      {
        "label": "Meet your people",
        "detail": "Enter the membership and Circle ecosystem."
      },
      {
        "label": "Begin the work",
        "detail": "SEE / FACE / CUT / GROW."
      }
    ],
    "kind": "steps",
    "title": "WHAT HAPPENS NEXT",
    "room": 4,
    "notes": "1. JOIN - complete registration.\n2. BUILD YOUR PROFILE - introduce yourself to the community.\n3. START FOUNDATIONS - begin the four-session experience.\n4. MEET YOUR PEOPLE - enter the membership and Circle ecosystem.\n5. BEGIN THE WORK - SEE / FACE / CUT / GROW.\nUse a simple registration QR code or URL in the finished deck."
  },
  {
    "id": "join-ruined",
    "headline": "RUINED",
    "body": "Join Ruined.",
    "kind": "close",
    "title": "FINAL RUINED VISUAL / JOIN",
    "room": 4,
    "notes": "Return to the brand rather than ending on a pricing table. Strong RUINED visual, minimal copy, and a clear registration\naction. Cade can determine the final visual treatment once the rest of the deck language is locked."
  }
];
