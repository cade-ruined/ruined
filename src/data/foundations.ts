export type FoundationChapterId =
  | "story"
  | "philosophy"
  | "culture"
  | "commitment";

export type FoundationStageId =
  | "entry"
  | "path"
  | FoundationChapterId
  | "welcome"
  | "overview";

export type FoundationAccent =
  | "danger"
  | "muted-blue"
  | "tan"
  | "paper"
  | "bone"
  | "white";

export type FoundationMotionTreatment =
  | "slash-reveal"
  | "mask-reveal"
  | "cut-away"
  | "replace"
  | "blur-to-focus"
  | "contract"
  | "open"
  | "duplicate-resolve"
  | "fragment-align"
  | "assemble";

export type FounderArtifactElementKind =
  | "annotation"
  | "date-stamp"
  | "design-sketchbook"
  | "folded-letter"
  | "handwritten-letter"
  | "handwriting"
  | "logo-sketches"
  | "map"
  | "metal-object"
  | "notebook"
  | "paper"
  | "photograph"
  | "pressed-flower"
  | "ruler"
  | "tan-material"
  | "thread"
  | "torn-edge"
  | "type-specimens";

export type FounderArtifactElement = {
  id: string;
  kind: FounderArtifactElementKind;
  label: string;
  detail?: string;
};

export type FounderStoryBeat = {
  id: "past" | "moment" | "reframe" | "commitment";
  label: string;
  body: string;
};

export type FoundationFounder = {
  name: string;
  role: string;
  duration: string;
  quote: string;
  accent: FoundationAccent;
  artifactLabel: string;
  artifactElements: readonly FounderArtifactElement[];
  supportingCopy?: readonly string[];
  storyFramework?: readonly FounderStoryBeat[];
};

export type FoundationStatement = {
  id: string;
  text: string;
  treatment: FoundationMotionTreatment;
};

export type FoundationWord = {
  word: string;
  treatment: FoundationMotionTreatment;
};

export type FoundationDnaCard = {
  id: string;
  title: string;
  statement: string;
};

export type FoundationExpectation = {
  id: string;
  statement: string;
};

export type FoundationPathStep = {
  id: string;
  title: string;
  description: string;
};

export type FoundationArtifactObject = {
  id: string;
  label: string;
  replacementAsset?: string;
};

export type FoundationReflectionField = {
  id: string;
  label: string;
  placeholder: string;
};

export type FoundationReflection = {
  id: string;
  kind: "single" | "rewrite" | "commitment" | "letter";
  title?: string;
  prompt: string;
  fields: readonly FoundationReflectionField[];
  actionLabel?: string;
  completionLabel?: string;
  interactionNote: string;
};

export type FoundationTeachingModule =
  | {
      id: string;
      kind: "statements";
      title?: string;
      statements: readonly FoundationStatement[];
    }
  | {
      id: string;
      kind: "word-sequence";
      words: readonly FoundationWord[];
    }
  | {
      id: string;
      kind: "responsibility-diagram";
      left: string;
      right: string;
      leftLabel: string;
      rightLabel: string;
      interaction: "draggable-divider";
    }
  | {
      id: string;
      kind: "noise-to-meaning";
      fragments: readonly string[];
      result: string;
      particleRange: readonly [number, number];
      transition: "diagonal-slash";
    }
  | {
      id: string;
      kind: "dna";
      title: string;
      cards: readonly FoundationDnaCard[];
    }
  | {
      id: string;
      kind: "expectations";
      title: string;
      expectations: readonly FoundationExpectation[];
    }
  | {
      id: string;
      kind: "path";
      steps: readonly FoundationPathStep[];
    }
  | {
      id: string;
      kind: "artifact-meaning";
      objects: readonly FoundationArtifactObject[];
      reveal: string;
      statements: readonly string[];
    }
  | {
      id: string;
      kind: "membership";
      statements: readonly string[];
      closing: readonly string[];
    };

export type FoundationChapter = {
  id: FoundationChapterId;
  number: string;
  title: string;
  coreQuestion: string;
  questionLines: readonly string[];
  founder: FoundationFounder;
  teaching: readonly FoundationTeachingModule[];
  reflection: FoundationReflection;
  symbolPieceId: FoundationChapterId;
};

export type FoundationSymbolPiece = {
  id: FoundationChapterId;
  number: string;
  label: string;
  points: string;
  tone: "light" | "dark";
};

export const FOUNDATION_META = {
  title: "Ruined Foundations",
  shortTitle: "Foundations",
  supportingLine: "A shared beginning.",
  purpose:
    "Foundations establishes the philosophy, culture, language, and expectations of Ruined before a member enters the broader community.",
  chapterCount: 4,
  reflectionCount: 4,
} as const;

export const FOUNDATION_ENTRY = {
  mark: {
    delayMs: 1500,
    wordmark: "RUINED",
    title: "FOUNDATIONS",
    supportingLine: FOUNDATION_META.supportingLine,
    prompt: "Press space to enter",
  },
  openingStatement: {
    lines: [
      "Before you enter the community,",
      "you enter the philosophy.",
    ],
    treatment: "mask-reveal" as const,
  },
  purpose: {
    initial: "This is not onboarding.",
    removedWord: "onboarding",
    replacement: "This is a shared starting point.",
    body: FOUNDATION_META.purpose,
    treatment: "cut-away" as const,
  },
} as const;

const STORY_SESSION = {
  id: "story",
  number: "01",
  title: "The Story",
  coreQuestion: "Why does Ruined exist?",
  questionLines: ["WHY", "DOES", "RUINED", "EXIST?"],
  founder: {
    name: "Tyler",
    role: "Founder Story",
    duration: "10–15 minutes",
    quote: "I thought the ending defined me.\nIt was only the beginning.",
    accent: "danger",
    artifactLabel: "Founder artifact / Tyler",
    artifactElements: [
      { id: "notebook", kind: "notebook", label: "Worn notebook" },
      {
        id: "photograph",
        kind: "photograph",
        label: "Black-and-white placeholder photograph",
        detail: "Replace with real founder artifact photography.",
      },
      { id: "date", kind: "date-stamp", label: "Date stamp" },
      {
        id: "note",
        kind: "handwriting",
        label: "Handwritten sentence",
      },
      { id: "edge", kind: "torn-edge", label: "Torn paper edge" },
      {
        id: "annotation",
        kind: "annotation",
        label: "Faint red annotation line",
      },
    ],
    storyFramework: [
      {
        id: "past",
        label: "Past",
        body: "The version of life I thought I was supposed to live.",
      },
      {
        id: "moment",
        label: "Defining Moment",
        body: "The moment the old story stopped working.",
      },
      {
        id: "reframe",
        label: "Reframe",
        body: "What looked like destruction became direction.",
      },
      {
        id: "commitment",
        label: "Commitment",
        body: "I chose to build a place where people could do the same.",
      },
    ],
  },
  teaching: [
    {
      id: "story-teaching",
      kind: "statements",
      statements: [
        {
          id: "original-purpose",
          text: "Society calls something ruined when it can no longer serve its original purpose.",
          treatment: "cut-away",
        },
        {
          id: "another-purpose",
          text: "But the loss of one purpose can reveal another.",
          treatment: "replace",
        },
        {
          id: "perspective",
          text: "Perspective changes what an experience means.",
          treatment: "slash-reveal",
        },
        {
          id: "possibility",
          text: "Meaning changes what becomes possible.",
          treatment: "mask-reveal",
        },
      ],
    },
  ],
  reflection: {
    id: "story-reflection",
    kind: "single",
    prompt: "Identify a moment that once felt like it defined your life.",
    fields: [
      {
        id: "defining-moment",
        label: "Your reflection",
        placeholder:
          "I believed losing that version of my life meant I had failed.",
      },
    ],
    actionLabel: "Continue",
    interactionNote:
      "Editable for the current presentation only; do not persist this response.",
  },
  symbolPieceId: "story",
} as const satisfies FoundationChapter;

const PHILOSOPHY_SESSION = {
  id: "philosophy",
  number: "02",
  title: "The Philosophy",
  coreQuestion:
    "What if the hardest moments of your life are not interruptions, but invitations?",
  questionLines: [
    "WHAT IF THE HARDEST MOMENTS",
    "OF YOUR LIFE ARE NOT",
    "INTERRUPTIONS,",
    "BUT INVITATIONS?",
  ],
  founder: {
    name: "Mitch",
    role: "Founder Story",
    duration: "10–15 minutes",
    quote:
      "The question was never,\n“Why did this happen?”\n\nThe question was,\n“What will I do with it?”",
    accent: "muted-blue",
    artifactLabel: "Founder artifact / Mitch",
    artifactElements: [
      { id: "letter", kind: "folded-letter", label: "Folded letter" },
      { id: "map", kind: "map", label: "Damaged map" },
      { id: "thread", kind: "thread", label: "Small piece of thread" },
      { id: "date", kind: "date-stamp", label: "Stamped date" },
      {
        id: "note",
        kind: "handwriting",
        label: "Handwritten phrase",
      },
      {
        id: "annotation",
        kind: "annotation",
        label: "Thin blue annotation",
      },
    ],
  },
  teaching: [
    {
      id: "philosophy-words",
      kind: "word-sequence",
      words: [
        { word: "BLAME", treatment: "blur-to-focus" },
        { word: "RESPONSIBILITY", treatment: "blur-to-focus" },
        { word: "FEAR", treatment: "contract" },
        { word: "CHOICE", treatment: "open" },
        { word: "IDENTITY", treatment: "duplicate-resolve" },
        { word: "MEANING", treatment: "fragment-align" },
        { word: "REBUILDING", treatment: "assemble" },
      ],
    },
    {
      id: "responsibility",
      kind: "responsibility-diagram",
      left: "WHAT HAPPENED TO ME",
      right: "WHAT I CHOOSE NEXT",
      leftLabel: "Blame asks who caused it.",
      rightLabel: "Responsibility asks what is mine now.",
      interaction: "draggable-divider",
    },
    {
      id: "choice",
      kind: "noise-to-meaning",
      fragments: [
        "fear",
        "failure",
        "shame",
        "expectation",
        "loss",
        "anger",
        "comparison",
        "control",
      ],
      result: "CHOICE",
      particleRange: [100, 200],
      transition: "diagonal-slash",
    },
  ],
  reflection: {
    id: "philosophy-reflection",
    kind: "rewrite",
    prompt: "Rewrite one story you have been telling yourself.",
    fields: [
      {
        id: "old-story",
        label: "The old story",
        placeholder: "I was left behind because I was not enough.",
      },
      {
        id: "chosen-story",
        label: "The story I choose now",
        placeholder:
          "That ending forced me to build an identity I had never chosen for myself.",
      },
    ],
    actionLabel: "Choose this story",
    interactionNote:
      "Strike through the old story when the chosen-story field becomes active; do not persist either response.",
  },
  symbolPieceId: "philosophy",
} as const satisfies FoundationChapter;

const CULTURE_SESSION = {
  id: "culture",
  number: "03",
  title: "The Culture",
  coreQuestion: "What kind of place is Ruined?",
  questionLines: ["WHAT KIND", "OF PLACE", "IS RUINED?"],
  founder: {
    name: "Cade",
    role: "Brand and Culture",
    duration: "10–15 minutes",
    quote: "Culture is what remains\nwhen no one is performing.",
    accent: "white",
    artifactLabel: "Founder artifact / Cade",
    artifactElements: [
      {
        id: "sketchbook",
        kind: "design-sketchbook",
        label: "Black design sketchbook",
      },
      {
        id: "logo-sketches",
        kind: "logo-sketches",
        label: "Abstract logo sketches",
      },
      {
        id: "type",
        kind: "type-specimens",
        label: "Cropped type specimens",
      },
      { id: "ruler", kind: "ruler", label: "Metal ruler" },
      { id: "paper", kind: "paper", label: "Cut piece of paper" },
      {
        id: "annotations",
        kind: "annotation",
        label: "White pencil annotations",
      },
    ],
    supportingCopy: [
      "The role of the brand is not to decorate the philosophy.",
      "The role of the brand is to make the philosophy visible.",
    ],
  },
  teaching: [
    {
      id: "ruined-dna",
      kind: "dna",
      title: "Ruined DNA",
      cards: [
        {
          id: "perspective",
          title: "Perspective",
          statement: "Meaning is not fixed.",
        },
        {
          id: "responsibility",
          title: "Responsibility",
          statement: "We own what is ours.",
        },
        {
          id: "discernment",
          title: "Discernment",
          statement: "We decide what deserves to remain.",
        },
        {
          id: "craft",
          title: "Craft",
          statement: "We care how things are made.",
        },
        {
          id: "action",
          title: "Action",
          statement: "Insight means little without movement.",
        },
        {
          id: "community",
          title: "Community",
          statement: "We rebuild beside other people.",
        },
      ],
    },
    {
      id: "culture-expectations",
      kind: "expectations",
      title: "How We Show Up",
      expectations: [
        {
          id: "truth",
          statement: "Tell the truth before it becomes convenient.",
        },
        {
          id: "responsibility",
          statement: "Take responsibility without turning it into shame.",
        },
        {
          id: "contribution",
          statement: "Contribute before asking what you receive.",
        },
        {
          id: "quality",
          statement: "Protect the quality of the room.",
        },
        {
          id: "performance",
          statement: "Do not confuse performance with transformation.",
        },
        {
          id: "action",
          statement: "Make what you learn visible through action.",
        },
      ],
    },
    {
      id: "the-path",
      kind: "path",
      steps: [
        {
          id: "experience",
          title: "Experience",
          description: "What happened.",
        },
        {
          id: "perspective",
          title: "Perspective",
          description: "What you believe it means.",
        },
        {
          id: "responsibility",
          title: "Responsibility",
          description: "What belongs to you now.",
        },
        {
          id: "choice",
          title: "Choice",
          description: "What you do next.",
        },
        {
          id: "identity",
          title: "Identity",
          description: "Who your choices begin to shape.",
        },
        {
          id: "commitment",
          title: "Commitment",
          description: "What you are willing to repeat.",
        },
        {
          id: "community",
          title: "Community",
          description: "Who you become beside others.",
        },
      ],
    },
    {
      id: "artifacts",
      kind: "artifact-meaning",
      objects: [
        { id: "letter", label: "Letter" },
        { id: "pin", label: "Pin" },
        { id: "journal", label: "Journal" },
        { id: "garment", label: "Garment" },
        { id: "card", label: "Card" },
        { id: "symbol", label: "Symbol" },
      ],
      reveal:
        "An artifact turns an internal decision into something visible.",
      statements: [
        "We do not create objects to prove that someone belongs.",
        "We create objects to remind them what they committed to.",
      ],
    },
  ],
  reflection: {
    id: "culture-reflection",
    kind: "commitment",
    prompt:
      "Write one commitment for how you will show up inside this community.",
    fields: [
      {
        id: "community-commitment",
        label: "My commitment",
        placeholder:
          "I will tell the truth sooner, take responsibility faster, and contribute before waiting to be asked.",
      },
    ],
    actionLabel: "Set commitment",
    interactionNote:
      "Setting the commitment assembles the third symbol piece; do not persist the response.",
  },
  symbolPieceId: "culture",
} as const satisfies FoundationChapter;

const COMMITMENT_SESSION = {
  id: "commitment",
  number: "04",
  title: "The Commitment",
  coreQuestion: "Who are you choosing to become?",
  questionLines: ["WHO ARE YOU", "CHOOSING", "TO BECOME?"],
  founder: {
    name: "Lib",
    role: "Founder Story",
    duration: "10–15 minutes",
    quote: "I stopped waiting to return\nto who I had been.",
    accent: "tan",
    artifactLabel: "Founder artifact / Lib",
    artifactElements: [
      {
        id: "letter",
        kind: "handwritten-letter",
        label: "Handwritten letter",
      },
      {
        id: "flower",
        kind: "pressed-flower",
        label: "Pressed flower",
      },
      { id: "photo", kind: "photograph", label: "Worn photograph" },
      {
        id: "thread-paper",
        kind: "thread",
        label: "Thread-bound paper",
      },
      {
        id: "metal",
        kind: "metal-object",
        label: "Small metallic object",
      },
      {
        id: "material",
        kind: "tan-material",
        label: "Soft tan material",
      },
    ],
  },
  teaching: [
    {
      id: "membership",
      kind: "membership",
      statements: [
        "Membership is not access.",
        "It is not proximity.",
        "It is not an identity someone gives you.",
        "It is a commitment you practice.",
      ],
      closing: ["RUINED IS SOMETHING", "YOU CHOOSE TO LIVE."],
    },
  ],
  reflection: {
    id: "future-letter",
    kind: "letter",
    title: "A Letter to Your Future Self",
    prompt: "Write forward from where you are now.",
    fields: [
      {
        id: "where-i-am",
        label: "1. This is where I am.",
        placeholder:
          "I am learning that certainty is not the same thing as safety.",
      },
      {
        id: "leaving-behind",
        label: "2. This is what I am leaving behind.",
        placeholder: "The need to be understood before I move.",
      },
      {
        id: "rebuilding-into",
        label: "3. This is who I am rebuilding into.",
        placeholder: "Someone who can act before fear disappears.",
      },
      {
        id: "promises",
        label: "4. These are the promises I am making.",
        placeholder: "I will stop abandoning my own decisions.",
      },
      {
        id: "if-reading",
        label: "5. If you are reading this...",
        placeholder:
          "Remember how impossible the next step once felt.\nYou took it anyway.",
      },
    ],
    actionLabel: "Complete letter",
    completionLabel: "Letter completion",
    interactionNote:
      "Reveal one editable prompt at a time, allow forward and backward movement, and show a completion percentage without persisting responses.",
  },
  symbolPieceId: "commitment",
} as const satisfies FoundationChapter;

export const FOUNDATION_SESSIONS = [
  STORY_SESSION,
  PHILOSOPHY_SESSION,
  CULTURE_SESSION,
  COMMITMENT_SESSION,
] as const satisfies readonly FoundationChapter[];

export const FOUNDATION_PATH_OVERVIEW = {
  title: "The Path",
  chapters: FOUNDATION_SESSIONS.map(
    ({ id, number, title, coreQuestion }) => ({
      id,
      number,
      title: title.replace(/^The /, ""),
      coreQuestion,
    })
  ),
} as const;

export const FOUNDATION_SYMBOL = {
  label: "The Ruined mark",
  viewBox: "0 0 100 100",
  description:
    "An asymmetric four-part mark assembled as each chapter is completed.",
  pieces: [
    {
      id: "story",
      number: "01",
      label: "Story",
      points: "7,11 46,7 40,36 16,43",
      tone: "light",
    },
    {
      id: "philosophy",
      number: "02",
      label: "Philosophy",
      points: "55,8 93,18 78,44 50,34",
      tone: "dark",
    },
    {
      id: "culture",
      number: "03",
      label: "Culture",
      points: "14,53 44,42 51,70 26,93",
      tone: "dark",
    },
    {
      id: "commitment",
      number: "04",
      label: "Commitment",
      points: "57,46 84,52 93,89 58,76",
      tone: "light",
    },
  ],
} as const satisfies {
  label: string;
  viewBox: string;
  description: string;
  pieces: readonly FoundationSymbolPiece[];
};

export const FOUNDATION_WELCOME = {
  symbolLabel: "Completed Ruined symbol",
  title: "WELCOME.",
  secondaryTitle: "AFTER THE FEAR.",
  body: [
    "You are not here because nothing happened to you.",
    "You are here because what happened does not get the final word.",
  ],
  actionLabel: "Enter Ruined",
} as const;

export const FOUNDATION_FINAL_OVERVIEW = {
  chapters: FOUNDATION_SESSIONS.map(({ id, title }) => ({
    id,
    title: title.replace(/^The /, "").toUpperCase(),
  })),
  summary: ["Four sessions.", "Four reflections.", "One shared beginning."],
  discussionQuestion: "What should Foundations feel like?",
  responseCards: [
    { id: "confronting", label: "Confronting" },
    { id: "grounding", label: "Grounding" },
    { id: "personal", label: "Personal" },
    { id: "transformative", label: "Transformative" },
  ],
  selectionLead: "Foundations should feel",
  agenda: ["Questions", "Discussion", "Next steps"],
} as const;

export const FOUNDATION_PRESENTER = {
  controls: [
    { id: "previous", label: "Previous" },
    { id: "next", label: "Next" },
    { id: "overview", label: "Chapter overview" },
    { id: "grain", label: "Toggle grain" },
    { id: "sound", label: "Toggle sound", initialState: "Sound off" },
    { id: "restart", label: "Restart experience" },
    { id: "fullscreen", label: "Enter fullscreen" },
  ],
  keyboard: [
    { keys: ["ArrowLeft"], action: "Previous moment" },
    { keys: ["ArrowRight", "Space"], action: "Next moment" },
    { keys: ["Escape"], action: "Open chapter overview" },
  ],
} as const;

// The ordered presentation contract. Complex moments retain their full payload
// here so the shell can switch on `kind` without hard-coding presentation copy.
export const FOUNDATION_MOMENTS = [
  {
    id: "entry-mark",
    stage: "entry",
    kind: "entry-mark",
    label: "Ruined Foundations",
    content: FOUNDATION_ENTRY.mark,
  },
  {
    id: "entry-statement",
    stage: "entry",
    kind: "statement",
    label: "Before the community",
    content: FOUNDATION_ENTRY.openingStatement,
  },
  {
    id: "entry-purpose",
    stage: "entry",
    kind: "purpose",
    label: "A shared starting point",
    content: FOUNDATION_ENTRY.purpose,
  },
  {
    id: "path-overview",
    stage: "path",
    kind: "chapter-path",
    label: "The Path",
    content: FOUNDATION_PATH_OVERVIEW,
  },
  {
    id: "story-opening",
    stage: "story",
    chapterId: "story",
    kind: "chapter-opening",
    label: STORY_SESSION.title,
    content: {
      number: STORY_SESSION.number,
      title: STORY_SESSION.title,
      coreQuestion: STORY_SESSION.coreQuestion,
      questionLines: STORY_SESSION.questionLines,
    },
  },
  {
    id: "story-founder",
    stage: "story",
    chapterId: "story",
    kind: "founder-artifact",
    label: "Tyler / Founder Story",
    content: STORY_SESSION.founder,
  },
  {
    id: "story-teaching",
    stage: "story",
    chapterId: "story",
    kind: "teaching",
    label: "The Reframe",
    content: STORY_SESSION.teaching[0],
  },
  {
    id: "story-reflection",
    stage: "story",
    chapterId: "story",
    kind: "reflection",
    label: "Reflection / Story",
    content: STORY_SESSION.reflection,
  },
  {
    id: "philosophy-opening",
    stage: "philosophy",
    chapterId: "philosophy",
    kind: "chapter-opening",
    label: PHILOSOPHY_SESSION.title,
    content: {
      number: PHILOSOPHY_SESSION.number,
      title: PHILOSOPHY_SESSION.title,
      coreQuestion: PHILOSOPHY_SESSION.coreQuestion,
      questionLines: PHILOSOPHY_SESSION.questionLines,
    },
  },
  {
    id: "philosophy-founder",
    stage: "philosophy",
    chapterId: "philosophy",
    kind: "founder-artifact",
    label: "Mitch / Founder Story",
    content: PHILOSOPHY_SESSION.founder,
  },
  {
    id: "philosophy-reframe",
    stage: "philosophy",
    chapterId: "philosophy",
    kind: "philosophy-reframe",
    label: "The Philosophy / Responsibility",
    content: {
      words: PHILOSOPHY_SESSION.teaching[0],
      responsibility: PHILOSOPHY_SESSION.teaching[1],
    },
  },
  {
    id: "philosophy-choice",
    stage: "philosophy",
    chapterId: "philosophy",
    kind: "noise-to-meaning",
    label: "Choice",
    content: PHILOSOPHY_SESSION.teaching[2],
  },
  {
    id: "philosophy-reflection",
    stage: "philosophy",
    chapterId: "philosophy",
    kind: "reflection",
    label: "Reflection / Philosophy",
    content: PHILOSOPHY_SESSION.reflection,
  },
  {
    id: "culture-opening",
    stage: "culture",
    chapterId: "culture",
    kind: "chapter-opening",
    label: CULTURE_SESSION.title,
    content: {
      number: CULTURE_SESSION.number,
      title: CULTURE_SESSION.title,
      coreQuestion: CULTURE_SESSION.coreQuestion,
      questionLines: CULTURE_SESSION.questionLines,
    },
  },
  {
    id: "culture-founder",
    stage: "culture",
    chapterId: "culture",
    kind: "founder-artifact",
    label: "Cade / Brand and Culture",
    content: CULTURE_SESSION.founder,
  },
  {
    id: "culture-code",
    stage: "culture",
    chapterId: "culture",
    kind: "culture-code",
    label: "Ruined DNA / How We Show Up",
    content: {
      dna: CULTURE_SESSION.teaching[0],
      expectations: CULTURE_SESSION.teaching[1],
    },
  },
  {
    id: "culture-path",
    stage: "culture",
    chapterId: "culture",
    kind: "path-and-artifacts",
    label: "The Path / Why Artifacts Matter",
    content: {
      path: CULTURE_SESSION.teaching[2],
      artifacts: CULTURE_SESSION.teaching[3],
    },
  },
  {
    id: "culture-reflection",
    stage: "culture",
    chapterId: "culture",
    kind: "reflection",
    label: "Reflection / Culture",
    content: CULTURE_SESSION.reflection,
  },
  {
    id: "commitment-opening",
    stage: "commitment",
    chapterId: "commitment",
    kind: "chapter-opening",
    label: COMMITMENT_SESSION.title,
    content: {
      number: COMMITMENT_SESSION.number,
      title: COMMITMENT_SESSION.title,
      coreQuestion: COMMITMENT_SESSION.coreQuestion,
      questionLines: COMMITMENT_SESSION.questionLines,
    },
  },
  {
    id: "commitment-founder-membership",
    stage: "commitment",
    chapterId: "commitment",
    kind: "founder-and-membership",
    label: "Lib / Membership",
    content: {
      founder: COMMITMENT_SESSION.founder,
      membership: COMMITMENT_SESSION.teaching[0],
    },
  },
  {
    id: "commitment-letter",
    stage: "commitment",
    chapterId: "commitment",
    kind: "letter",
    label: "A Letter to Your Future Self",
    content: COMMITMENT_SESSION.reflection,
  },
  {
    id: "closing",
    stage: "welcome",
    kind: "welcome-and-overview",
    label: "Official Welcome / Foundations Overview",
    content: {
      welcome: FOUNDATION_WELCOME,
      overview: FOUNDATION_FINAL_OVERVIEW,
    },
  },
] as const;

export type FoundationMoment = (typeof FOUNDATION_MOMENTS)[number];
