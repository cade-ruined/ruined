/**
 * Foundations 01 follows the supplied Cade build brief.
 * The audience sees visual anchors; the full teaching context stays in notes.
 * Story details, speaker ownership, and section timing remain intentionally open.
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
    | "bridge";
  room: 0 | 1 | 2 | 3 | 4;
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
  location: "Lobby" | "Artifacts" | "About" | "Members" | "Community";
  /** One-based inclusive slide numbers. */
  start: number;
  end: number;
};

export const FOUNDATION_CALL_CHAPTERS: FoundationCallChapter[] = [
  { room: 0, title: "Our story", location: "Lobby", start: 1, end: 3 },
  { room: 1, title: "People", location: "Artifacts", start: 4, end: 7 },
  { room: 2, title: "Common ground", location: "About", start: 8, end: 12 },
  { room: 3, title: "Your timeline", location: "Members", start: 13, end: 19 },
  { room: 4, title: "What comes next", location: "Community", start: 20, end: 22 },
];

export const FOUNDATION_CALL_SLIDES: FoundationCallSlide[] = [
  {
    id: "foundations-01",
    title: "FOUNDATIONS 01",
    headline: "FOUNDATIONS\n01",
    kind: "cover",
    room: 0,
    eyebrow: "RU/NED",
    footer: "AFTER THE FEAR.",
    notes: `Welcome. Foundations is where Membership begins. Keep this human and brief.

F1 is about understanding what shaped us, what we made it mean, and why Ruined exists in the first place. “Story” is the internal organizing topic, not a required member-facing module name. The member-facing title is FOUNDATIONS 01.

Speaker assignments and final timing remain open. Leave room for the conversation.`,
  },
  {
    id: "your-story-our-story",
    title: "YOUR STORY / OUR STORY",
    headline: "Your story.\nOur story.",
    kind: "pair",
    room: 0,
    pairs: [
      { label: "Your story", text: "What shaped you.\nWhat you made it mean." },
      { label: "Our story", text: "Why we exist.\nWhat we believe." },
    ],
    lines: ["Why Ruined", "What Ruined means", "Founder story", "Events vs. stories", "Your Timeline", "Reflection"],
    footer: "A clearer understanding of both.",
    notes: `F1 has two simultaneous outcomes. Make both visible from the beginning.

YOUR STORY
Begin understanding the experiences that shaped you. Identify the meaning attached to those experiences. Recognize the stories and beliefs you carried forward, and how they may still influence who you are today.

OUR STORY
Understand why Ruined exists and why the founders created it; what we mean by “Ruined”; what we fundamentally believe; why people and community matter; and why Foundations exists before the ongoing Membership experience.

ROADMAP
Why Ruined → What does Ruined mean? → Founder story → Events vs. Stories → Your Ruined Timeline → Reflection.

By the end of today, you’ll begin building your own Ruined Timeline and have a clearer understanding of both your story and the community you’ve joined.`,
  },
  {
    id: "why-ruined",
    title: "WHY RUINED?",
    headline: "The community\nwe wish we’d had.",
    kind: "statement",
    room: 0,
    eyebrow: "WHY WE BUILT IT",
    notes: `Ruined came out of our actual lives: loss, failure, relationships, business, fear, mistakes, and starting over. Speak from actual experience without making this an autobiography or an inventory of pain.

We wanted to build some version of the community we wish we’d had during different seasons of our own lives.

Some of our deepest relationships were built through the things people normally don’t talk about. That realization leads into the relationship framework on the next slide.`,
  },
  {
    id: "honesty-to-relationship",
    title: "HONESTY TO RELATIONSHIP",
    headline: "How connection\nbegins.",
    kind: "sequence",
    room: 1,
    steps: ["HONESTY", "VULNERABILITY", "TRUST", "RELATIONSHIP"],
    footer: "The things we normally don’t talk about.",
    notes: `HONESTY → VULNERABILITY → TRUST → RELATIONSHIP.

Walk through the progression. Honesty creates the possibility of vulnerability. Vulnerability can build trust. Trust gives a relationship depth. Connect this to the founders’ realization that some of their deepest relationships grew through the things people normally do not talk about.

Move from our stories to the human experience. You do not need to be destroyed to be Ruined. This is not a trauma competition. People do not need to prove that their experience is painful enough to belong.`,
  },
  {
    id: "people-need-people",
    title: "PEOPLE NEED PEOPLE",
    headline: "People\nneed people.",
    kind: "pair",
    room: 1,
    pairs: [
      { label: "Knowing people", text: "Being known" },
      { label: "Followers", text: "Community" },
      { label: "Agreement", text: "Truth" },
    ],
    footer: "FIND YOUR PEOPLE.",
    notes: `Let PEOPLE NEED PEOPLE stand as a strong visual moment. Pair it with FIND YOUR PEOPLE.

Knowing people / Being known.
Followers / Community.
Agreement / Truth.

Use these distinctions to explain why people and community matter. Being connected to many people is not automatically the same as being known. A following is not automatically a community. A relationship can make room for truth without requiring constant agreement.`,
  },
  {
    id: "core-belief",
    title: "WHAT WE BELIEVE",
    headline: "The moments that threaten\nto ruin your life often become\nthe foundation of the life\nyou’re meant to build.",
    kind: "statement",
    room: 1,
    eyebrow: "WHAT WE BELIEVE",
    lines: ["This does not mean trauma is good or everything happens for a reason."],
    footer: "Pain does not automatically create growth.",
    notes: `Our core belief: The moments that threaten to ruin your life often become the foundation of the life you’re meant to build.

Say the nuance out loud. We are not saying everything happens for a reason. We are not saying trauma is good. We are not saying pain automatically creates growth.

Do not force a positive lesson onto someone’s experience. Hold the possibility of a future without telling people what their past was for.`,
  },
  {
    id: "after-the-fear",
    title: "AFTER THE FEAR",
    headline: "AFTER\nTHE FEAR.",
    kind: "statement",
    room: 1,
    lines: ["The conversation. The truth. The decision.", "The boundary. The risk. The apology.", "The vulnerability. The change."],
    footer: "It happened. What happens next is still ours.",
    notes: `AFTER THE FEAR is connected to ordinary, consequential moments: the conversation, truth, decision, boundary, risk, apology, vulnerability, and change.

It happened. What happens next is still ours.

Keep this at the level of the belief. Today’s exercise is about seeing what happened and what we made it mean; it does not ask members to choose a new meaning yet.`,
  },
  {
    id: "common-ground",
    title: "WHY FOUNDATIONS",
    headline: "Common\nground.",
    kind: "sequence",
    room: 2,
    eyebrow: "WHY FOUNDATIONS",
    steps: ["Shared language", "Shared understanding", "Shared expectations", "Shared experience"],
    footer: "Real community does not happen by accident.",
    notes: `Foundations exists because real community does not happen by accident. A group chat plus Zoom calls is not enough.

We begin with common ground: shared language, shared understanding, shared expectations, and shared experience. This creates a shared starting point before the ongoing Membership experience.

INTERNAL CONTEXT ONLY
STORY → MEANING → COMMUNITY → ACTION is the internal journey. Do not present it as a finished branded curriculum or add new module names.`,
  },
  {
    id: "how-we-show-up",
    title: "HOW WE SHOW UP",
    headline: "How we\nshow up.",
    kind: "prompts",
    room: 2,
    lines: ["Be honest. Participate. Stay curious.", "Don’t compare. Respect confidentiality.", "Don’t fix people. Don’t perform vulnerability."],
    footer: "You don’t have to share everything. But don’t lie to yourself.",
    notes: `The culture of this room:
• Be honest.
• Participate.
• Stay curious.
• Don’t compare.
• Respect confidentiality.
• Don’t fix people.
• Don’t perform vulnerability.

You don’t have to share everything. But don’t lie to yourself.

Participation does not require disclosing every detail. Members should have room to reflect without being pushed to perform a vulnerable moment for the group.`,
  },
  {
    id: "what-ruined-means",
    title: "WHAT DOES RUINED MEAN?",
    headline: "The story\nis not finished.",
    kind: "sequence",
    room: 2,
    eyebrow: "WHAT DOES IT MEAN TO BE RUINED?",
    steps: ["Something happened.", "It affected you.", "You made it mean something.", "It became part of your story."],
    notes: `RUINED IS NOT
Broken forever. A victim. Damaged. Defined by trauma. Celebrating suffering.

RUINED RECOGNIZES
Something happened. It affected you. You made it mean something. That meaning became part of your story. The story is not finished.

This is a recognition of what has shaped us, not a requirement to identify ourselves with suffering. Do not turn the sequence into a claim that everyone responds the same way.`,
  },
  {
    id: "core-model",
    title: "FROM EVENT TO LIFE",
    headline: "What happened.\nWhat followed.",
    kind: "model",
    room: 2,
    steps: ["EVENT", "MEANING / STORY", "BELIEF", "IDENTITY", "BEHAVIOR", "LIFE"],
    footer: "What happened is now part of my material. What I build with it isn’t finished.",
    notes: `EVENT → MEANING / STORY → BELIEF → IDENTITY → BEHAVIOR → LIFE.

Introduce the whole framework. An event happens. We attach meaning to it and create a story. That story can become a belief, shape our sense of identity, influence behavior, and affect our life.

What happened is now part of my material. What I build with it isn’t finished.

Today we begin by noticing the event and the meaning or story attached to it. Recognize what followed without asking members to change it yet.`,
  },
  {
    id: "tys-story",
    title: "TY’S STORY",
    headline: "What happened.\nWhat I made it mean.",
    kind: "founder",
    room: 2,
    eyebrow: "TY’S STORY",
    footer: "An experience. A meaning. A story carried forward.",
    notes: `TY’S STORY
Final story beats and supporting assets are still pending. Use this frame for Ty’s live story.

The purpose is not autobiography. Ty models the exact process members are about to use:
• What happened?
• What did I make it mean?
• What story or belief did I begin carrying?
• How did that show up later?
• What can I see now that I couldn’t see then?

Speaker ownership for the wider call and final timing by section remain open.`,
  },
  {
    id: "event-vs-story",
    title: "EVENTS VS. STORIES",
    headline: "Event.\nStory.",
    kind: "event-story",
    room: 3,
    pairs: [
      { label: "EVENT", text: "What actually happened." },
      { label: "STORY", text: "What I decided it meant." },
    ],
    lines: ["Someone betrayed me → People can’t be trusted.", "Business failed → I’m a failure."],
    footer: "What story did I create? Is it still influencing me?",
    notes: `EVENT: What actually happened.
STORY: What I decided it meant.

EXAMPLE 1
Event: Someone betrayed me.
Possible stories: I’m not enough. People can’t be trusted. People eventually leave. I was stupid for trusting them.

EXAMPLE 2
Event: Business failed.
Possible stories: I’m a failure. I can’t trust myself. Risk is dangerous. I need to prove everyone wrong.

Different people may attach different stories to an experience. Keep the distinction clear without judging the member’s interpretation.

The question is not “Is my story true or false?” Today’s question is: WHAT STORY DID I CREATE? Is it still influencing me?`,
  },
  {
    id: "ruined-timeline",
    title: "YOUR RUINED TIMELINE",
    headline: "Your Ruined Timeline.",
    kind: "timeline",
    room: 3,
    eyebrow: "PART I",
    steps: ["BIRTH", "TODAY"],
    pairs: [
      { label: "WHAT HAPPENED?", text: "The experience." },
      { label: "WHAT DID I MAKE IT MEAN?", text: "The story you carried." },
    ],
    footer: "Begin with what you remember.",
    notes: `This is the centerpiece exercise of Foundations 01: THE RUINED TIMELINE — PART I.

WHAT HAPPENED? → WHAT DID I MAKE IT MEAN?

Create a clear life timeline from BIRTH → TODAY. Identify meaningful experiences, both positive and negative. The visual artifact separates an event from the meaning attached to it, so members can return to the same timeline in Foundations 02.

Introduce the worksheet or template and let members begin. They are not expected to finish their entire life timeline during this call. The between-call work is to finish it and remain curious.`,
  },
  {
    id: "what-happened",
    title: "START WITH WHAT HAPPENED",
    headline: "Start with\nwhat happened.",
    kind: "prompts",
    room: 3,
    lines: ["Positive and negative experiences.", "Moments with emotional weight.", "Experiences that changed what happened next."],
    footer: "BIRTH → TODAY",
    notes: `Identify meaningful experiences along the timeline. Include positive and negative experiences; do not limit the exercise to painful events.

Suggested categories:
• Family.
• Relationships.
• Success.
• Failure.
• Business / career.
• Money.
• Health.
• Identity / beliefs.
• Important people.
• Major decisions.
• Transitions.
• Loss.
• Pride.
• Shame.

Look for experiences with emotional weight or experiences that clearly changed what happened next. These categories are memory prompts, not required boxes that everyone has to fill.`,
  },
  {
    id: "what-did-it-mean",
    title: "WHAT DID I MAKE IT MEAN?",
    headline: "What did I\nmake it mean?",
    kind: "prompts",
    room: 3,
    lines: ["About me?", "About other people?", "About life?", "What did I begin believing?"],
    notes: `For the experiences identified on the timeline, ask the central meaning questions:
• What did this mean about me?
• What did this mean about other people?
• What did this mean about life?
• What did I begin believing because of it?

Keep the experience and the interpretation distinct. Write down what you made it mean, including the language you remember carrying at the time. You do not need to find a better or more positive interpretation today.

This is observation. Do not ask members whether the story is true or false, how it served them, or what it cost them.`,
  },
  {
    id: "positive-stories",
    title: "POSITIVE EXPERIENCES CREATE STORIES TOO",
    headline: "Positive experiences\ncreate stories too.",
    kind: "examples",
    room: 3,
    pairs: [
      { label: "Dad left", text: "People leave." },
      { label: "Won championship", text: "I’m valuable when I win." },
      { label: "Bullied", text: "Something is wrong with me." },
      { label: "Built a successful company", text: "I can figure anything out." },
    ],
    footer: "Some become strengths. Some become cages. Some become both.",
    notes: `Positive experiences create stories too. Use both kinds of experience to make this visible.

Dad left → People leave.
Won championship → I’m valuable when I win.
Bullied → Something is wrong with me.
Built a successful company → I can figure anything out.

Some stories become strengths. Some become cages. Some become both.

These are examples of possible interpretations, not universal outcomes. Today members notice the stories that developed. Do not turn this into an evaluation of how a belief has served them or what it has cost them; those questions belong to Foundations 02.`,
  },
  {
    id: "patterns",
    title: "LOOK FOR PATTERNS",
    headline: "Different events.\nThe same story.",
    kind: "prompts",
    room: 3,
    lines: ["I’m not enough.", "People leave.", "I have to prove myself.", "I’m on my own.", "I can figure things out.", "Hard things don’t last forever."],
    notes: `Look for patterns. Different events may create the same underlying story.

Examples include:
• I’m not enough.
• People leave.
• I have to prove myself.
• I’m on my own.
• I can figure things out.
• Hard things don’t last forever.

Invite members to notice whether similar language appears after different experiences. Include positive stories in the pattern search. There is no requirement to produce a single explanation for their life or decide what to change today.`,
  },
  {
    id: "reflection",
    title: "REFLECTION",
    headline: "What did\nyou notice?",
    kind: "prompts",
    room: 3,
    lines: ["What surprised you?", "What shaped you more than you realized?", "What story have you carried the longest?", "Did the same story appear after different events?", "Did you identify positive stories?", "Did you connect a belief to an experience for the first time?"],
    notes: `Use these reflection prompts with room to pause:
• What surprised you?
• What shaped you more than you realized?
• What story have you carried the longest?
• Did the same story appear after different events?
• Did you identify positive stories?
• Did you connect a belief to an experience for the first time?

Members do not have to share everything. Respect confidentiality, do not fix people, and do not reward a performance of vulnerability.

F1 BOUNDARY
Do NOT ask “How has this served me?” or “How has this cost me?” in F1. Those questions are intentionally held for Foundations 02. Do not introduce a rewriting, gratitude, forgiveness, or positive-lesson exercise here.`,
  },
  {
    id: "review",
    title: "WHAT WE BEGAN TO SEE",
    headline: "Our story.\nYour story.",
    kind: "review",
    room: 4,
    pairs: [
      { label: "RUINED", text: "Why we exist.\nWhat we believe.\nWhy people matter." },
      { label: "YOU", text: "What happened.\nWhat you made it mean.\nWhat stories you carried." },
    ],
    footer: "Today was about learning to see the difference.",
    notes: `REVIEW: WHAT MEMBERS LEARNED ABOUT RUINED
Why we created it. What we mean by Ruined. Why people matter. Why Foundations exists. Some of what we believe.

REVIEW: WHAT MEMBERS BEGAN LEARNING ABOUT THEMSELVES
What happened. What they made it mean. What stories developed. What patterns may exist.

What happened is part of your story.
What you made it mean became another part.
Today wasn’t about changing either one.
It was about learning to see the difference.`,
  },
  {
    id: "between-calls",
    title: "BETWEEN CALLS",
    headline: "Finish your\ntimeline.",
    kind: "pair",
    room: 4,
    eyebrow: "BETWEEN FOUNDATIONS 01 / 02",
    pairs: [
      { label: "WHAT HAPPENED?", text: "Keep noticing the experiences." },
      { label: "WHAT DID I MAKE IT MEAN?", text: "Keep noticing the stories." },
    ],
    footer: "Just get curious.",
    notes: `Between calls, finish the Ruined Timeline.

Continue asking WHAT HAPPENED? and WHAT DID I MAKE IT MEAN?

Do not force gratitude, forgiveness, a positive lesson, or a reframe. Just get curious.

Keep the timeline. Foundations 02 returns to this exact same artifact. Do not assign a replacement story, ask members to decide whether a belief was useful, or add further homework beyond the brief.`,
  },
  {
    id: "foundations-02",
    title: "FOUNDATIONS 02",
    headline: "The same timeline.\nA different set\nof questions.",
    kind: "bridge",
    room: 4,
    eyebrow: "NEXT: FOUNDATIONS 02",
    lines: ["What happened isn’t changing."],
    footer: "Is the meaning you’ve carried the only meaning available to you?",
    notes: `CLOSING BRIDGE
Today we asked: What happened, and what did I make it mean?

In Foundations 2, we’re going back to this exact same timeline, but we’re going to ask a very different set of questions.

Because what happened isn’t changing.

The question is whether the meaning you’ve carried from it is the only meaning available to you.

End here. This is the bridge into Foundations 02, not the start of a reframing exercise during F1.

AFTER THE FEAR.`,
  },
];
