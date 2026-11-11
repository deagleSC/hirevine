import { PolicyPage } from "@/components/policy";

export const metadata = { title: "Privacy notice" };

export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy notice" updated="11 November 2026">
      <p>
        Hirevine is used by hiring teams to run job applications. When you apply, the hiring team is responsible for your
        application, and Hirevine processes your data on their behalf to run each step of their process.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Your account: email address, display name, and that you confirmed you are 18 or older.</li>
        <li>Each application: the resume you upload, the text read from it, answers to screening questions, your consent record.</li>
        <li>If the job includes them: your quiz answers and your AI interview transcript.</li>
        <li>Results the hiring team records, their feedback to you, and in-app notifications.</li>
      </ul>
      <h2>How it is used</h2>
      <p>
        To run the steps of the job you applied to, show the hiring team your application, and release outcomes and feedback
        to you. Personal details such as your name, email, phone number and links are removed from resume text before any AI
        model reads it. See <a className="underline" href="/ai-evaluation">how AI evaluation works</a>.
      </p>
      <h2>Who processes it</h2>
      <ul>
        <li>Supabase: database, sign-in and file storage (your resume files are in a private bucket).</li>
        <li>Vercel: hosting for the website and the API.</li>
        <li>Inngest: runs background steps such as screening. It receives record IDs only, never your resume or answers.</li>
        <li>
          OpenRouter and the model providers it routes to (currently Google Gemma and NVIDIA Nemotron models): read redacted
          resume text, quiz and interview answers to produce scores and feedback drafts.
        </li>
        <li>Langfuse, if enabled: records model calls for quality checks, with redacted text only.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>Download everything stored about you from your Account page at any time.</li>
        <li>Delete your account from your Account page. This erases your resumes, answers, transcripts, results and feedback.</li>
        <li>You only see results and feedback after the hiring team releases outcomes for the whole job.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>Until you delete your account. A fixed retention period after a job closes is planned before the pilot.</p>
    </PolicyPage>
  );
}
