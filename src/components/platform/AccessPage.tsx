import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";

export default function AccessPage({ enabled, returnTo }: { enabled: boolean; returnTo?: string }) {
  return (
    <main className="min-h-screen bg-[#080605] px-4 pb-16 pt-[calc(var(--ruined-header-height)+2.5rem)] text-[var(--color-bone)] sm:px-6 sm:pb-24 sm:pt-[calc(var(--ruined-header-height)+4rem)] lg:px-10">
      <div className="mx-auto grid max-w-[88rem] gap-14 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,29rem)] xl:items-end xl:gap-24">
        <div className="xl:pb-8">
          <h1 className="max-w-5xl font-[var(--font-header)] text-[clamp(3.65rem,9vw,8.7rem)] font-bold uppercase leading-[0.79] tracking-[-0.055em]">
            <span className="box-decoration-clone bg-[var(--color-signal)] px-[0.08em] text-[#080605]">
              Welcome back.
            </span>
          </h1>
        </div>

        <section
          aria-labelledby="platform-access-title"
          className="w-full max-w-[46rem] rounded-[5px] bg-[var(--color-bone)] p-5 text-[#201d19] shadow-[7px_7px_0_var(--color-poster)] sm:p-7 md:justify-self-end lg:p-8 xl:max-w-none"
        >
          <p className="font-cadehandy2 text-2xl leading-none text-[var(--color-poster)]">
            Access
          </p>
          <h2
            className="mt-3 font-[var(--font-header)] text-[clamp(2.4rem,5vw,3.75rem)] font-bold uppercase leading-[0.86] tracking-[-0.045em]"
            id="platform-access-title"
          >
            Enter Ruined
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-black/58">
            Use the email connected to Ruined. After you enter the code, your account opens the right space automatically.
          </p>
          <PasswordlessAccessForm enabled={enabled} returnTo={returnTo} />
          <p className="mt-6 text-sm leading-relaxed text-black/60">
            Trouble signing in? <a className="inline-flex min-h-11 items-center underline decoration-black/30 underline-offset-4 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black" href="mailto:connect@theruinedproject.com">Contact connect@theruinedproject.com</a>
          </p>
        </section>
      </div>
    </main>
  );
}
