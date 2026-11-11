import { PolicyPage } from "@/components/policy";

export const metadata = { title: "How AI evaluation works" };

export default function AiEvaluationPage() {
  return (
    <PolicyPage title="How AI evaluation works" updated="11 November 2026">
      <p>
        Hiring teams on Hirevine use AI to help review applications. Here is what it does at each step, and what it does not do.
      </p>
      <h2>Resume screening</h2>
      <p>
        Your name, contact details and links are removed from the text read from your resume. An AI model then scores it against
        the skills the hiring team listed. Every score must quote a line from your resume; a score whose quote cannot be found in
        the resume is set to zero. Text in a resume that tries to instruct the AI is ignored and flagged to the hiring team.
      </p>
      <h2>Skills quiz</h2>
      <p>Multiple-choice questions, timed, and graded exactly against the answer key. The AI may help the team write the questions.</p>
      <h2>AI interview</h2>
      <p>
        If the job has one, you are told before you start that the interviewer is an AI. It asks one question at a time about the
        role, and never asks about age, family, religion, health, nationality or other personal matters. Your answers are scored
        against the team&apos;s rubric, and each score must point to the answers it is based on.
      </p>
      <h2>Feedback and decisions</h2>
      <p>
        The AI drafts feedback for you from this evidence. The hiring team reviews the results, can score any step by hand, and
        edits the feedback before releasing it. Decisions are made by people. Outcomes are released to everyone who applied to a
        job at the same time, with the evidence behind them.
      </p>
      <h2>What the AI is never told</h2>
      <p>
        Your name, contact details or photo. It is instructed not to consider age, gender, ethnicity, religion, disability, family
        status, nationality or any other personal characteristic, and not to judge writing style or accent.
      </p>
    </PolicyPage>
  );
}
