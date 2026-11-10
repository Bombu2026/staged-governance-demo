import { Badge, Panel } from "./ui";

const QUESTIONS = [
  {
    q: "What may the token vote on?",
    detail: "Which decisions move to token holders, and which stay out of reach, such as escrow logic or awards already approved.",
  },
  {
    q: "How do you prevent buying an outcome?",
    detail: "A token can be bought on the day of a vote. Snapshots, lockups or time-weighting each trade openness for resistance.",
  },
  {
    q: "How does it coexist with Proof of Love power?",
    detail: "Points measure accepted work and tokens measure holdings. Both could be required, one could advise the other, or each could own a separate domain.",
  },
  {
    q: "Who can veto?",
    detail: "Whether moderators, the multisig or nobody keeps a veto once a token exists, for how long, and how that veto is itself retired.",
  },
];

export function StageToken() {
  return (
    <div className="space-y-6">
      <p className="max-w-prose text-lg leading-relaxed">
        The last stage hands some decisions to token holders. Nothing here is simulated, because until a token exists the
        useful work is answering the questions below, and those answers shape every mechanism that would follow.
      </p>
      <Panel title="Token governance" meta={<Badge tone="warning">Design question</Badge>}>
        <p className="text-[15px] text-muted">Not simulated. Open questions to settle before any token vote counts:</p>
        <ul className="divide-y divide-line border-y border-line">
          {QUESTIONS.map(({ q, detail }) => (
            <li key={q} className="px-2 py-[18px]">
              <p className="text-lg font-bold leading-snug">{q}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{detail}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
