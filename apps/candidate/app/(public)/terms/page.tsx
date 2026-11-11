import { PolicyPage } from "@/components/policy";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <PolicyPage title="Terms" updated="11 November 2026">
      <h2>Using Hirevine</h2>
      <ul>
        <li>You must be 18 or older to create an account or apply.</li>
        <li>Upload only your own resume, and answer quizzes and interviews yourself, without help from other people or tools.</li>
        <li>Do not include instructions aimed at the AI in your resume or answers. They are flagged to the hiring team and ignored.</li>
        <li>Each job allows one attempt at its quiz and its interview.</li>
      </ul>
      <h2>Decisions</h2>
      <p>
        Hiring decisions are made by the hiring team, not by Hirevine. AI scores and drafts help the team review applications;
        the team reviews results, can score by hand, and edits the feedback you receive.
      </p>
      <h2>Your account</h2>
      <p>You can download your data or delete your account at any time from your Account page.</p>
    </PolicyPage>
  );
}
