import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";

export default function AccessPage({enabled,returnTo}:{enabled:boolean;returnTo?:string}) {
  return <main className="member-journey-page member-access-page">
    <div className="member-access-intro"><p className="member-handwritten">Your way back in</p><h1 className="member-page-title">A little space.<br/>For what matters.</h1><p>Welcome back to Ruined.</p></div>
    <section aria-labelledby="platform-access-title" className="member-access-form"><p className="member-handwritten">Come on in</p><h2 id="platform-access-title">Enter Ruined</h2><p className="member-muted">Enter the email we have for you. We’ll send you a sign-in code.</p><PasswordlessAccessForm enabled={enabled} returnTo={returnTo}/><p className="member-access-help">Need a hand? <a href="mailto:connect@theruinedproject.com">Contact Ruined</a></p></section>
  </main>;
}
