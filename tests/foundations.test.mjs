import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");

async function loadFoundationsData() {
  const source = await fs.readFile(
    path.join(root, "src", "data", "foundations.ts"),
    "utf8"
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("foundations data defines the ordered four-session, 22-moment journey", async () => {
  const data = await loadFoundationsData();
  const sessions = data.FOUNDATION_SESSIONS;

  assert.equal(sessions.length, 4);
  assert.deepEqual(
    sessions.map(({ id }) => id),
    ["story", "philosophy", "culture", "commitment"]
  );
  assert.deepEqual(
    sessions.map(({ number }) => number),
    ["01", "02", "03", "04"]
  );
  assert.deepEqual(
    sessions.map(({ founder }) => founder.name),
    ["Tyler", "Mitch", "Cade", "Lib"]
  );
  assert.deepEqual(
    sessions.map(({ coreQuestion }) => coreQuestion),
    [
      "Why does Ruined exist?",
      "What if the hardest moments of your life are not interruptions, but invitations?",
      "What kind of place is Ruined?",
      "Who are you choosing to become?",
    ]
  );
  assert.equal(data.FOUNDATION_MOMENTS.length, 22);
  assert.equal(
    new Set(data.FOUNDATION_MOMENTS.map(({ id }) => id)).size,
    data.FOUNDATION_MOMENTS.length
  );
  assert.equal(sessions[3].reflection.fields.length, 5);

  for (const session of sessions) {
    assert.ok(session.founder.role);
    assert.ok(session.founder.duration);
    assert.ok(session.founder.quote);
    assert.ok(session.founder.artifactElements.length >= 6);
    assert.ok(session.teaching.length > 0);
    assert.ok(session.reflection.prompt);
    assert.ok(session.reflection.fields.length > 0);
  }
});

test("foundations route is local, private by default, and presentation-ready", async () => {
  const files = [
    "app/foundations/page.tsx",
    "app/foundations/README.md",
    "src/data/foundations.ts",
    "src/components/foundations/PresentationShell.tsx",
    "src/components/foundations/ChapterOverview.tsx",
    "src/components/foundations/PresenterControls.tsx",
    "src/components/foundations/ProgressPath.tsx",
    "src/components/foundations/FounderArtifact.tsx",
    "src/components/foundations/ReflectionPrompt.tsx",
    "src/components/foundations/PhilosophyNoise.tsx",
    "src/components/foundations/RuinedMarkBuilder.tsx",
  ];

  const sources = await Promise.all(
    files.map(async (file) => {
      await fs.access(path.join(root, file));
      return fs.readFile(path.join(root, file), "utf8");
    })
  );
  const joined = sources.join("\n");
  const page = sources[0];
  const shell = sources[3];

  assert.match(page, /title: "Foundations"/);
  assert.match(page, /canonical: "\/foundations"/);
  assert.match(shell, /ArrowRight/);
  assert.match(shell, /ArrowLeft/);
  assert.match(shell, /event\.code === "Space"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /IntersectionObserver/);
  assert.match(shell, /requestFullscreen/);
  assert.match(shell, /aria-live="polite"/);
  assert.doesNotMatch(
    joined,
    /localStorage|sessionStorage|document\.cookie|fetch\(|https?:\/\//
  );
});
