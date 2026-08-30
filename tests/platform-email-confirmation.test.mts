import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  consumeMemberEmailConfirmationLocation,
  getMemberEmailConfirmationStatus,
} from "../src/lib/auth/email-confirmation.ts";
import {
  getMemberEmailConfirmationUrl,
  isTrustedPlatformOrigin,
} from "../src/lib/auth/request.ts";

const [confirmedPage, confirmationStatusComponent] = await Promise.all([
  readFile(new URL("../app/my/confirmed/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../src/components/platform/MemberEmailConfirmationStatus.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("local development accepts equivalent loopback origins only on the same port", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_SITE_URL = "https://theruinedproject.com";

    assert.equal(
      isTrustedPlatformOrigin(
        new Request("http://localhost:3000/api/auth/otp/request", {
          headers: { origin: "http://127.0.0.1:3000" },
        }),
      ),
      true,
    );
    assert.equal(
      isTrustedPlatformOrigin(
        new Request("http://127.0.0.1:3000/api/auth/otp/request", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
      true,
    );
    assert.equal(
      isTrustedPlatformOrigin(
        new Request("http://localhost:3000/api/auth/otp/request", {
          headers: { origin: "http://127.0.0.1:3001" },
        }),
      ),
      false,
    );
    assert.equal(
      isTrustedPlatformOrigin(
        new Request("http://localhost:3000/api/auth/otp/request", {
          headers: { origin: "http://attacker.example" },
        }),
      ),
      false,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("production keeps loopback origins distinct", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://theruinedproject.com";

    assert.equal(
      isTrustedPlatformOrigin(
        new Request("http://localhost:3000/api/auth/otp/request", {
          headers: { origin: "http://127.0.0.1:3000" },
        }),
      ),
      false,
    );
    assert.equal(
      isTrustedPlatformOrigin(
        new Request("https://theruinedproject.com/api/auth/otp/request", {
          headers: { origin: "https://theruinedproject.com" },
        }),
      ),
      true,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("member signup confirmation uses only a configured secure site origin in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://members.example.com/untrusted/path";

    assert.equal(
      getMemberEmailConfirmationUrl(
        new Request("https://attacker.example/api/auth/otp/request"),
      ),
      "https://members.example.com/my/confirmed",
    );

    process.env.NEXT_PUBLIC_SITE_URL = "http://members.example.com";
    assert.equal(
      getMemberEmailConfirmationUrl(
        new Request("https://members.example.com/api/auth/otp/request"),
      ),
      null,
    );

    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(
      getMemberEmailConfirmationUrl(
        new Request("https://attacker.example/api/auth/otp/request"),
      ),
      null,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("local development can derive the exact confirmation route from its own URL", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    process.env.NODE_ENV = "development";
    delete process.env.NEXT_PUBLIC_SITE_URL;

    assert.equal(
      getMemberEmailConfirmationUrl(
        new Request("http://localhost:3000/api/auth/otp/request"),
      ),
      "http://localhost:3000/my/confirmed",
    );
    assert.equal(
      getMemberEmailConfirmationUrl(
        new Request("http://attacker.example/api/auth/otp/request"),
      ),
      null,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
  }
});

test("successful Supabase callbacks report confirmation without consuming a session", () => {
  assert.equal(getMemberEmailConfirmationStatus("?code=pkce-code", ""), "confirmed");
  assert.equal(
    getMemberEmailConfirmationStatus(
      "",
      "#access_token=sensitive&type=signup&refresh_token=also-sensitive",
    ),
    "confirmed",
  );
  assert.doesNotMatch(
    confirmationStatusComponent,
    /createBrowserClient|exchangeCodeForSession|setSession|verifyOtp|fetch\(/,
  );
});

test("Supabase errors take precedence over apparent success values", () => {
  assert.equal(
    getMemberEmailConfirmationStatus(
      "?code=unused&error=access_denied&error_code=otp_expired",
      "",
    ),
    "error",
  );
  assert.equal(
    getMemberEmailConfirmationStatus("", "#error_description=Link+expired"),
    "error",
  );
});

test("a bare or unrelated direct visit stays neutral", () => {
  assert.equal(getMemberEmailConfirmationStatus("", ""), "neutral");
  assert.equal(getMemberEmailConfirmationStatus("?source=email", "#details"), "neutral");
  assert.match(confirmationStatusComponent, /useState<MemberEmailConfirmationStatus>\("neutral"\)/);
  assert.match(confirmationStatusComponent, /Visiting this page by itself does not confirm/);
});

test("callback details are immediately removed from the address bar", () => {
  const replacements: Array<{ data: unknown; url: string | URL | null | undefined }> = [];
  const historyState = { nextInternalState: true };

  const status = consumeMemberEmailConfirmationLocation({
    history: {
      state: historyState,
      replaceState(data, _unused, url) {
        replacements.push({ data, url });
      },
    },
    location: {
      hash: "#access_token=sensitive&type=signup",
      search: "?source=supabase",
    },
  });

  assert.equal(status, "confirmed");
  assert.deepEqual(replacements, [
    { data: historyState, url: "/my/confirmed" },
  ]);
  assert.match(confirmationStatusComponent, /useLayoutEffect/);
});

test("React Strict Mode cannot consume the stripped callback twice", () => {
  const guardIndex = confirmationStatusComponent.indexOf("if (consumed.current) return");
  const markConsumedIndex = confirmationStatusComponent.indexOf("consumed.current = true");
  const consumeIndex = confirmationStatusComponent.indexOf(
    "consumeMemberEmailConfirmationLocation({",
  );

  assert.match(confirmationStatusComponent, /const consumed = useRef\(false\)/);
  assert.ok(guardIndex >= 0, "the effect must stop after its first pass");
  assert.ok(markConsumedIndex > guardIndex, "the first pass must mark the callback consumed");
  assert.ok(consumeIndex > markConsumedIndex, "the guard must run before reading and stripping the URL");
});

test("the confirmation page and access link suppress referrer details", () => {
  assert.match(confirmedPage, /title: "Email confirmation"/);
  assert.match(confirmedPage, /referrer: "no-referrer"/);
  assert.match(confirmedPage, /A place with your name on it\./);
  assert.match(confirmationStatusComponent, /Email confirmed\./);
  assert.match(confirmationStatusComponent, /Continue to member access and request a one-time code\./);
  assert.match(confirmationStatusComponent, /href="\/my\/access"/);
  assert.match(confirmationStatusComponent, /referrerPolicy="no-referrer"/);
});
