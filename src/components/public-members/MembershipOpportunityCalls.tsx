import { OPPORTUNITY_CALLS, googleCalendarUrl } from "@/data/opportunity-calls";
import styles from "./MembershipOpportunityCalls.module.css";

export default function MembershipOpportunityCalls() {
  return (
    <section className={styles.section} id="opportunity-calls" aria-labelledby="opportunity-calls-heading">
      <div className={styles.inner}>
        <div className={styles.introduction}>
          <p className={styles.eyebrow}>October 2026</p>
          <h2 className={styles.heading} id="opportunity-calls-heading">Opportunity Calls.</h2>
          <p className={styles.description}>Join us live on Google Meet.</p>
        </div>
        <div className={styles.calls}>
          {OPPORTUNITY_CALLS.map(call => (
            <article className={styles.call} key={call.id} aria-labelledby={`call-${call.id}`}>
              <h3 className={styles.date} id={`call-${call.id}`}>
                <time dateTime={call.startsAt}>{call.dateLabel}</time>
              </h3>
              <p className={styles.time}>6–7 PM · Denver time</p>
              <div className={styles.actions}>
                <details className={styles.calendar} name="opportunity-call-calendars">
                  <summary aria-label={`Add ${call.dateLabel} Opportunity Call to calendar`}>
                    Add to calendar <span aria-hidden="true">+</span>
                  </summary>
                  <div className={styles.calendarOptions}>
                    <a href={googleCalendarUrl(call)} target="_blank" rel="noopener noreferrer">Google Calendar <span aria-hidden="true">↗</span></a>
                    <a href={call.calendarFile} download>Apple / Outlook <span aria-hidden="true">↓</span></a>
                  </div>
                </details>
                <a className={styles.join} href={call.meetUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join ${call.dateLabel} Opportunity Call`}>
                  Join call <span aria-hidden="true">↗</span>
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
