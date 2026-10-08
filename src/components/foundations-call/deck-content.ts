/**
 * Audience flow follows the supplied 34-slide rebuilt review deck.
 * Styling and interaction remain native to Ruined's web presentation.
 * Speaker notes below are written from the slide content; the PPTX notes
 * contain serialization errors and are not treated as recovered narration.
 */
export type FoundationCallSlide = {
  id: string;
  title: string;
  headline: string;
  kind:
    | "cover"
    | "statement"
    | "pair"
    | "sequence"
    | "model"
    | "founder"
    | "event-story"
    | "timeline"
    | "prompts"
    | "examples"
    | "review"
    | "bridge"
    | "section"
    | "definition"
    | "word-field"
    | "date"
    | "influence"
    | "perspective"
    | "exercise";
  room: 0 | 1 | 2 | 3 | 4;
  theme: "ink" | "bone" | "blue" | "tan";
  notes: string;
  eyebrow?: string;
  lines?: string[];
  pairs?: { label: string; text: string }[];
  steps?: string[];
  footer?: string;
};

export type FoundationCallChapter = {
  room: FoundationCallSlide["room"];
  title: string;
  /** One-based inclusive slide numbers. */
  start: number;
  end: number;
};

export const FOUNDATION_CALL_CHAPTERS: FoundationCallChapter[] = [
  { room: 0, title: "Our story", start: 1, end: 8 },
  { room: 1, title: "Foundations", start: 9, end: 13 },
  { room: 2, title: "Founder story", start: 14, end: 15 },
  { room: 3, title: "Your timeline", start: 16, end: 29 },
  { room: 4, title: "What comes next", start: 30, end: 34 },
];

export const FOUNDATION_CALL_SLIDES: FoundationCallSlide[] = [
  {
    "id": "foundations-01",
    "title": "FOUNDATIONS 01",
    "headline": "FOUNDATIONS\n01",
    "kind": "cover",
    "room": 0,
    "theme": "ink",
    "eyebrow": "RU/NED",
    "footer": "AFTER THE FEAR.",
    "notes": "Welcome to Foundations 01. The call moves from why Ruined exists to the experiences and meanings that have shaped each member. Let the opening breathe."
  },
  {
    "id": "your-story-our-story",
    "title": "THE PURPOSE OF THIS CALL",
    "headline": "The purpose\nof this call",
    "kind": "pair",
    "room": 0,
    "theme": "bone",
    "eyebrow": "START HERE",
    "pairs": [
      {
        "label": "YOUR STORY",
        "text": "Begin understanding what shaped you, what you made it mean, and the stories that may still influence you."
      },
      {
        "label": "OUR STORY",
        "text": "Understand why Ruined exists, what we mean by Ruined, and what we believe."
      }
    ],
    "notes": "Introduce both purposes: understanding your story and understanding our story. Make both outcomes clear before moving into the roadmap."
  },
  {
    "id": "roadmap",
    "title": "WHERE WE’RE GOING",
    "headline": "Where we’re\ngoing",
    "kind": "sequence",
    "room": 0,
    "theme": "ink",
    "eyebrow": "PREVIEW",
    "steps": [
      "WHY RUINED",
      "WHAT “RUINED” MEANS",
      "WHY FOUNDATIONS",
      "A FOUNDER STORY",
      "EVENTS VS. STORIES",
      "YOUR RUINED TIMELINE + WHAT’S NEXT"
    ],
    "notes": "Preview the six parts in this order. The founder story leads into the distinction between events and stories, followed by the member Timeline exercise."
  },
  {
    "id": "why-ruined",
    "title": "WHY WE CREATED RUINED",
    "headline": "Why we\ncreated Ruined",
    "kind": "word-field",
    "room": 0,
    "theme": "tan",
    "eyebrow": "OUR STORY",
    "lines": [
      "LOSS",
      "FAILURE",
      "DIVORCE",
      "RELATIONSHIPS",
      "ADDICTION",
      "BUSINESS",
      "FEAR",
      "MISTAKES",
      "STARTING OVER"
    ],
    "footer": "RUINED DIDN’T START AS A BUSINESS PLAN.",
    "notes": "Ruined came from actual life experience. These words are prompts for the founders, not a requirement to share every detail or an inventory of pain."
  },
  {
    "id": "core-belief",
    "title": "THE RUINED THESIS",
    "headline": "The moments that threaten to ruin your life often become the foundation of the life you’re meant to build.",
    "kind": "statement",
    "room": 0,
    "theme": "ink",
    "eyebrow": "WHAT WE BELIEVE",
    "footer": "It happened. What happens next is still ours.",
    "notes": "This is the Ruined thesis. Hold the possibility of what comes next without telling anyone that trauma is good, suffering is necessary, or every experience needs a positive explanation."
  },
  {
    "id": "what-ruined-means",
    "title": "WHAT DOES IT MEAN TO BE RUINED?",
    "headline": "What does it mean\nto be Ruined?",
    "kind": "definition",
    "room": 0,
    "theme": "bone",
    "eyebrow": "THE NAME",
    "pairs": [
      {
        "label": "RUINED IS NOT",
        "text": "Broken forever\nVictim\nDamaged\nDefined by trauma\nCelebrating suffering"
      },
      {
        "label": "RUINED RECOGNIZES",
        "text": "Life changes us.\nWe interpret what happens.\nMeaning becomes story.\nStory can become belief.\nThe story is not finished."
      }
    ],
    "notes": "Distinguish the name from being permanently broken or defined by trauma. The recognition is that life changes us and meaning can become story and belief. The story is not finished."
  },
  {
    "id": "everyone",
    "title": "YOU DON’T HAVE TO BE DESTROYED TO BE RUINED",
    "headline": "You don’t have to be\ndestroyed to be Ruined",
    "kind": "statement",
    "room": 0,
    "theme": "bone",
    "eyebrow": "FROM US TO EVERYONE",
    "lines": [
      "Hard things happen to everyone.",
      "Nothing catastrophic has to be wrong for you to want more.",
      "Growth, deeper relationships, accountability and aligned people are enough reason to be here."
    ],
    "footer": "NOT A TRAUMA COMPETITION\nNo one gets extra points because their life sucked more.",
    "notes": "Make the invitation explicit. Nothing catastrophic has to be wrong. Growth, relationships, accountability, and aligned people are enough reason to participate. No one needs to prove that their experience was painful enough."
  },
  {
    "id": "after-the-fear",
    "title": "AFTER THE FEAR",
    "headline": "AFTER\nTHE FEAR",
    "kind": "word-field",
    "room": 0,
    "theme": "ink",
    "eyebrow": "A RUINED IDEA",
    "lines": [
      "THE CONVERSATION",
      "THE TRUTH",
      "THE DECISION",
      "THE BOUNDARY",
      "THE RISK",
      "THE APOLOGY",
      "THE VULNERABILITY",
      "THE CHANGE"
    ],
    "footer": "What becomes possible when fear stops making the important decisions?",
    "notes": "Connect After the Fear to consequential moments in ordinary life. Pause on the question of what becomes possible when fear no longer makes the important decisions."
  },
  {
    "id": "foundations",
    "title": "FOUNDATIONS",
    "headline": "FOUNDATIONS",
    "kind": "section",
    "room": 1,
    "theme": "blue",
    "footer": "Why Foundations exists and how we agree to show up.",
    "notes": "Transition from why Ruined exists to why Foundations exists and how this community agrees to show up."
  },
  {
    "id": "membership-begins",
    "title": "THIS IS WHERE MEMBERSHIP BEGINS",
    "headline": "This is where\nMembership begins",
    "kind": "statement",
    "room": 1,
    "theme": "bone",
    "eyebrow": "WELCOME",
    "lines": [
      "Foundations isn’t something you finish before Ruined starts.",
      "It is where Ruined starts."
    ],
    "footer": "You don’t need to impress anybody here.",
    "notes": "Foundations is the beginning of Membership itself. Take the pressure to impress off the room."
  },
  {
    "id": "common-ground",
    "title": "COMMUNITY + CULTURE DOESN’T HAPPEN BY ACCIDENT",
    "headline": "Community + Culture\ndoesn’t happen by accident",
    "kind": "sequence",
    "room": 1,
    "theme": "ink",
    "eyebrow": "WHY FOUNDATIONS",
    "steps": [
      "SHARED LANGUAGE",
      "SHARED UNDERSTANDING",
      "SHARED EXPECTATIONS",
      "SHARED EXPERIENCE"
    ],
    "footer": "A group chat + weekly Zoom calls ≠ community.",
    "notes": "A group chat and weekly calls do not create community by themselves. Foundations gives members shared language, understanding, expectations, and experience."
  },
  {
    "id": "how-we-show-up",
    "title": "HOW WE SHOW UP",
    "headline": "How we\nshow up",
    "kind": "prompts",
    "room": 1,
    "theme": "bone",
    "eyebrow": "CULTURE",
    "pairs": [
      {
        "label": "BE HONEST",
        "text": "Especially with yourself."
      },
      {
        "label": "PARTICIPATE",
        "text": "You get more from doing than watching."
      },
      {
        "label": "STAY CURIOUS",
        "text": "Examine before defending."
      },
      {
        "label": "DON’T COMPARE",
        "text": "No trauma competition."
      },
      {
        "label": "CONFIDENTIALITY",
        "text": "Treat people’s truth with respect."
      },
      {
        "label": "DON’T FIX PEOPLE",
        "text": "Listen. Ask. Support."
      },
      {
        "label": "DON’T PERFORM",
        "text": "Vulnerability isn’t theater."
      }
    ],
    "notes": "Walk through the culture of the room. Participation can include honest private reflection. Respect confidentiality and make room for people without fixing them or rewarding performed vulnerability."
  },
  {
    "id": "honesty-to-relationship",
    "title": "RELATIONSHIPS CHANGE WHEN TRUTH DOES",
    "headline": "Relationships change\nwhen truth does.",
    "kind": "sequence",
    "room": 1,
    "theme": "blue",
    "eyebrow": "WHAT WE LEARNED",
    "steps": [
      "HONESTY",
      "VULNERABILITY",
      "TRUST",
      "RELATIONSHIP"
    ],
    "pairs": [
      {
        "label": "HONESTY",
        "text": "Tell the truth"
      },
      {
        "label": "VULNERABILITY",
        "text": "Let yourself be known"
      },
      {
        "label": "TRUST",
        "text": "Earn safety over time"
      },
      {
        "label": "RELATIONSHIP",
        "text": "Build something real"
      }
    ],
    "footer": "Some of the things we thought we needed to hide became the things that connected us most deeply.",
    "notes": "Walk through the relationship progression. Trust is earned over time. Connect this to the founders’ recognition that some of what they thought they needed to hide became what connected them most deeply."
  },
  {
    "id": "founder-story",
    "title": "FOUNDER STORY",
    "headline": "FOUNDER\nSTORY",
    "kind": "section",
    "room": 2,
    "theme": "ink",
    "footer": "Tyler Bastian",
    "notes": "Introduce Tyler Bastian and give the conversation room to move into his story."
  },
  {
    "id": "tys-story",
    "title": "TY’S STORY",
    "headline": "Ty’s story",
    "kind": "founder",
    "room": 2,
    "theme": "tan",
    "eyebrow": "FOUNDER EXAMPLE",
    "lines": [
      "WHAT HAPPENED?",
      "WHAT DID I MAKE IT MEAN?",
      "WHAT DID I START BELIEVING?",
      "HOW DID IT SHOW UP LATER?",
      "WHAT CAN I SEE NOW?"
    ],
    "notes": "The supplied review deck marks Ty’s final story as still to be added. Do not invent details. Use these questions to support his live story: what happened, what he made it mean, what he started believing, how it showed up later, and what he can see now."
  },
  {
    "id": "your-timeline",
    "title": "YOUR TIMELINE",
    "headline": "YOUR\nTIMELINE",
    "kind": "section",
    "room": 3,
    "theme": "blue",
    "footer": "Move from our story to yours.",
    "notes": "Transition from the founder example to the member’s own story."
  },
  {
    "id": "core-model",
    "title": "HOW AN EVENT CAN BECOME A LIFE",
    "headline": "How an event\ncan become a life",
    "kind": "model",
    "room": 3,
    "theme": "bone",
    "eyebrow": "FRAMEWORK",
    "steps": [
      "EVENT",
      "MEANING / STORY",
      "BELIEF",
      "IDENTITY",
      "BEHAVIOR",
      "LIFE"
    ],
    "pairs": [
      {
        "label": "EVENT",
        "text": "What happened"
      },
      {
        "label": "MEANING / STORY",
        "text": "What I made it mean"
      },
      {
        "label": "BELIEF",
        "text": "What I started believing"
      },
      {
        "label": "IDENTITY",
        "text": "Who I became"
      },
      {
        "label": "BEHAVIOR",
        "text": "How I showed up"
      },
      {
        "label": "LIFE",
        "text": "What compounded"
      }
    ],
    "footer": "What happened is now part of my material. What I build with it isn’t finished.",
    "notes": "Introduce the framework as a way to notice possible connections, not a claim that everyone responds identically. An event can lead to meaning, belief, identity, behavior, and effects that compound over time."
  },
  {
    "id": "event-vs-story",
    "title": "EVENT ≠ STORY",
    "headline": "Event ≠ Story",
    "kind": "event-story",
    "room": 3,
    "theme": "ink",
    "eyebrow": "THE DISTINCTION",
    "pairs": [
      {
        "label": "EVENT",
        "text": "What actually happened."
      },
      {
        "label": "STORY",
        "text": "What I decided it meant."
      }
    ],
    "footer": "Stories aren’t necessarily lies. Some protected us. Some drove us. Some did both.",
    "notes": "Keep the event distinct from the interpretation. A story is not necessarily a lie. Some stories protected us, some drove us, and some did both."
  },
  {
    "id": "betrayal-example",
    "title": "SAME EVENT. DIFFERENT STORIES.",
    "headline": "Same event.\nDifferent stories.",
    "kind": "examples",
    "room": 3,
    "theme": "bone",
    "eyebrow": "EXAMPLE",
    "pairs": [
      {
        "label": "EVENT",
        "text": "Someone betrayed me."
      }
    ],
    "lines": [
      "I’m not enough.",
      "People can’t be trusted.",
      "I was stupid for trusting.",
      "People eventually leave.",
      "I need control to feel safe."
    ],
    "notes": "These are possible interpretations of the same event, not universal conclusions. Notice how each interpretation changes what a person might begin believing."
  },
  {
    "id": "business-example",
    "title": "MEANING CAN CREATE STRENGTH AND COST",
    "headline": "Meaning can create\nstrength and cost",
    "kind": "examples",
    "room": 3,
    "theme": "tan",
    "eyebrow": "ANOTHER EXAMPLE",
    "pairs": [
      {
        "label": "EVENT",
        "text": "The business failed."
      }
    ],
    "lines": [
      "I’m a failure.",
      "I can’t trust myself.",
      "Risk is dangerous.",
      "I’ll prove everyone wrong.",
      "I’m only valuable when I’m winning."
    ],
    "notes": "Use business failure as another example of how meaning can vary. Notice the tension in a story that can create drive while tying value to winning."
  },
  {
    "id": "ruined-timeline",
    "title": "YOUR RUINED TIMELINE",
    "headline": "Your Ruined\nTimeline",
    "kind": "timeline",
    "room": 3,
    "theme": "blue",
    "eyebrow": "THE EXERCISE",
    "pairs": [
      {
        "label": "WHAT HAPPENED?",
        "text": "The experience."
      },
      {
        "label": "WHAT DID YOU MAKE IT MEAN?",
        "text": "The story you carried."
      }
    ],
    "footer": "Start with awareness. Don’t force a reframe.",
    "notes": "Introduce the connected Timeline. Members separate what happened from what they made it mean. The exercise begins with awareness, without requiring a reframe."
  },
  {
    "id": "what-happened",
    "title": "WHAT HAPPENED?",
    "headline": "What happened?",
    "kind": "prompts",
    "room": 3,
    "theme": "bone",
    "eyebrow": "TIMELINE · 01",
    "lines": [
      "Family",
      "Childhood",
      "Parents",
      "Siblings",
      "Friendships",
      "Relationships",
      "Marriage / Divorce",
      "Children / Parenthood",
      "School",
      "Sports",
      "Career",
      "Business",
      "Money",
      "Success",
      "Failure",
      "Health",
      "Loss / Death",
      "Faith / Beliefs",
      "Identity",
      "Major Decisions / Transitions"
    ],
    "pairs": [
      {
        "label": "THE EVENT",
        "text": "Describe the event in a few words or 1–2 sentences."
      }
    ],
    "footer": "Don’t only look for the hardest moments. Include experiences that changed you, good or bad.",
    "notes": "Ask members to describe an event in a few words or one or two sentences. The categories are prompts, not boxes to complete. Include experiences that changed them, good or bad."
  },
  {
    "id": "when-it-happened",
    "title": "WHEN DID IT HAPPEN?",
    "headline": "When did\nit happen?",
    "kind": "date",
    "room": 3,
    "theme": "ink",
    "eyebrow": "TIMELINE · 02",
    "lines": [
      "MONTH / YEAR"
    ],
    "footer": "Don’t remember exactly? Close is good enough.",
    "notes": "An approximate date is enough. The Timeline accepts a year with an optional month; members do not need an exact day or perfect recall."
  },
  {
    "id": "what-did-it-mean",
    "title": "WHAT DID YOU MAKE IT MEAN?",
    "headline": "What did you\nmake it mean?",
    "kind": "examples",
    "room": 3,
    "theme": "bone",
    "eyebrow": "TIMELINE · 03",
    "pairs": [
      {
        "label": "EVENT",
        "text": "My parents divorced."
      }
    ],
    "lines": [
      "People leave.",
      "Relationships don’t last.",
      "I need to take care of myself.",
      "Conflict means something is ending.",
      "I need to keep everyone happy."
    ],
    "footer": "Think about what you began believing about yourself, other people, or life.",
    "notes": "Ask what members began believing about themselves, other people, or life. These are possible stories someone might attach to their parents’ divorce, not necessary outcomes of that event."
  },
  {
    "id": "how-it-shaped-you",
    "title": "HOW DID THAT MEANING SHAPE YOU?",
    "headline": "How did that\nmeaning shape you?",
    "kind": "influence",
    "room": 3,
    "theme": "bone",
    "eyebrow": "TIMELINE · 04",
    "pairs": [
      {
        "label": "“I HAVE TO TAKE CARE OF MYSELF.”",
        "text": "Independent\nResourceful\nDriven\nBad at asking for help\nUncomfortable depending on people"
      },
      {
        "label": "“I’M VALUABLE WHEN I WIN.”",
        "text": "Competitive\nDisciplined\nSuccessful\nAfraid of failure\nAlways proving myself"
      }
    ],
    "footer": "How did that belief influence who you became, the choices you made, or how you showed up afterward?",
    "notes": "The rebuilt flow asks members to notice how meaning influenced their identity, choices, or behavior. A belief may lead to strengths and difficulties at the same time. Do not require a judgment or a new belief."
  },
  {
    "id": "what-you-see-now",
    "title": "WHAT DO YOU SEE DIFFERENTLY NOW?",
    "headline": "What do you see\ndifferently now?",
    "kind": "perspective",
    "room": 3,
    "theme": "ink",
    "eyebrow": "TIMELINE · 05",
    "pairs": [
      {
        "label": "THEN",
        "text": "“My parents’ divorce meant relationships don’t last.”\n“Losing the business meant I failed.”"
      },
      {
        "label": "NOW",
        "text": "“Their relationship ending didn’t determine what mine would become.”\n“I can see how much of my identity was tied to winning.”"
      }
    ],
    "footer": "You don’t have to turn every experience into a blessing. If you don’t see it differently yet, that’s okay too.",
    "notes": "Present these as possible observations, not required replacements for someone’s story. The rebuilt flow makes present-day perspective optional. Explicitly allow members to see nothing differently yet and never require turning an experience into a blessing."
  },
  {
    "id": "patterns",
    "title": "WHAT REPEATS?",
    "headline": "What repeats?",
    "kind": "word-field",
    "room": 3,
    "theme": "tan",
    "eyebrow": "ZOOM OUT",
    "lines": [
      "I’M NOT ENOUGH.",
      "PEOPLE LEAVE.",
      "I HAVE TO PROVE MYSELF.",
      "I’M ON MY OWN.",
      "I CAN FIGURE THINGS OUT.",
      "HARD THINGS DON’T LAST FOREVER."
    ],
    "notes": "Zoom out across the Timeline. Similar stories may appear after different events. Include beliefs that supported members as well as beliefs they find difficult."
  },
  {
    "id": "timeline-exercise",
    "title": "TIMELINE EXERCISE · 10 MINUTES",
    "headline": "Timeline\nexercise",
    "kind": "exercise",
    "room": 3,
    "theme": "blue",
    "eyebrow": "10 MINUTES",
    "lines": [
      "Open Ruined Profile: Complete 1–3 timeline events."
    ],
    "notes": "Give members ten minutes to open their Ruined Profile and complete one to three Timeline events. This is a beginning, not a requirement to finish their whole life Timeline during the call. Leave room for quiet work."
  },
  {
    "id": "reflection",
    "title": "WHAT DID YOU NOTICE?",
    "headline": "What did\nyou notice?",
    "kind": "prompts",
    "room": 3,
    "theme": "bone",
    "eyebrow": "REFLECTION",
    "lines": [
      "What surprised you?",
      "What shaped you more than you realized?",
      "What story have you carried the longest?",
      "Did the same story appear after different events?",
      "Did you identify a positive story that shaped you?",
      "Did you connect a belief to an experience for the first time?"
    ],
    "footer": "Sharing is voluntary. Curiosity is required.",
    "notes": "Invite reflection without requiring disclosure. Let people choose whether to share, keep the room curious, and avoid fixing or interpreting another member’s story."
  },
  {
    "id": "what-comes-next",
    "title": "WHAT COMES NEXT",
    "headline": "WHAT\nCOMES NEXT",
    "kind": "section",
    "room": 4,
    "theme": "ink",
    "notes": "Review what was learned, invite members to finish their Timeline, and introduce the question that leads into Foundations 02. The supplied review deck’s “create tension for F2” line is production guidance, not audience copy."
  },
  {
    "id": "review",
    "title": "WHAT WE COVERED",
    "headline": "What we\ncovered",
    "kind": "review",
    "room": 4,
    "theme": "bone",
    "eyebrow": "REVIEW",
    "pairs": [
      {
        "label": "ABOUT RUINED",
        "text": "Why we created it\nWhat “Ruined” means\nWhy people matter\nWhy Foundations exists\nSome of what we believe"
      },
      {
        "label": "ABOUT YOU",
        "text": "What happened\nWhat you made it mean\nStories that developed\nPatterns across your life\nWhat may still influence you"
      }
    ],
    "notes": "Review both outcomes: what members learned about Ruined and what they began noticing about their own story."
  },
  {
    "id": "event-and-meaning",
    "title": "LEARNING TO SEE THE DIFFERENCE",
    "headline": "What happened is\npart of your story.",
    "kind": "statement",
    "room": 4,
    "theme": "ink",
    "lines": [
      "What you made it mean became another part.",
      "Today wasn’t about changing either one.",
      "It was about learning to see the difference."
    ],
    "notes": "Let the distinction settle. Today begins with seeing the experience and the meaning attached to it. There is no requirement to change either one."
  },
  {
    "id": "between-calls",
    "title": "FINISH YOUR RUINED TIMELINE",
    "headline": "Finish your\nRuined Timeline",
    "kind": "pair",
    "room": 4,
    "theme": "bone",
    "eyebrow": "BEFORE FOUNDATIONS 02",
    "pairs": [
      {
        "label": "KEEP ASKING",
        "text": "WHAT HAPPENED?\nWHAT DID I MAKE IT MEAN?"
      },
      {
        "label": "DON’T FORCE",
        "text": "Gratitude\nForgiveness\nA positive lesson\nA motivational reframe"
      }
    ],
    "footer": "JUST GET CURIOUS.",
    "notes": "Before Foundations 02, finish the same Timeline. Keep asking what happened and what it meant. Do not assign forced gratitude, forgiveness, a positive lesson, or a motivational reframe."
  },
  {
    "id": "foundations-02",
    "title": "FOUNDATIONS 02",
    "headline": "Foundations\n02",
    "kind": "bridge",
    "room": 4,
    "theme": "ink",
    "eyebrow": "NEXT",
    "lines": [
      "What happened isn’t changing.",
      "The question is whether the meaning you’ve carried from it is the only meaning available to you."
    ],
    "footer": "AFTER THE FEAR.",
    "notes": "Close on the question of whether the meaning members have carried is the only meaning available to them. Foundations 02 returns to the same Timeline. End here rather than beginning the next session’s exercise."
  }
];
