# Early Circle access for the founding team

Founders already assigned to their Circle can receive an Administrator-approved, audited early reveal of My Circle without completing their Foundations exercises. Normal account, membership funding, profile release and participation checks still apply. Other members continue to see their Circle after Foundations completion.

Access is tied to the exact current Circle assignment. A move, ended assignment, inactive Circle or revocation invalidates the grant. Grant evidence records the Administrator, reason, member and Circle and cannot be rewritten or deleted. It can be revoked by recording an Administrator and reason. No public/client write API is added.

Apply `20261015120000_circle_early_reveal.sql` before deploying the app. The migration grants nobody access and creates no completion proof, milestone, badge or message. The requested operational update is separate and restricted to the five current Founders Circle assignments verified at execution time.

Validation covers database permissions and revocation, actual member repository reads, calendar/meeting access and retained Foundations progress. Check the production My Circle page after release. For rollback, revoke the five grants; leave the additive schema and audit history intact.
