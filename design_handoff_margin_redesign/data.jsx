// data.jsx — mock content for the prototype. Exported to window.

const HANDLE = 'devnotjared';

// Library of the user's own captured tweets (the "voice").
const LIBRARY = [
  { id: 'l1', type: 'post', source: 'captured', text: "shipping something every day is less about the shipping and more about the forcing function. you can't hide a stale repo from yourself." },
  { id: 'l2', type: 'reply', source: 'captured', text: "honestly the boring answer is usually right here — write the test first, then the code stops arguing with you." },
  { id: 'l3', type: 'post', source: 'manual', text: "hot take: most \"AI tools\" are just a text box with extra steps. the ones that win make the box disappear." },
  { id: 'l4', type: 'reply', source: 'captured', text: "yeah I bounced off it too. the docs assume you already know the thing the docs are supposed to teach you." },
  { id: 'l5', type: 'post', source: 'captured', text: "spent the morning deleting code. net negative diff, net positive day." },
  { id: 'l6', type: 'reply', source: 'manual', text: "the trick that finally made it click for me was treating the cache as a lie you choose to believe for 60 seconds." },
  { id: 'l7', type: 'post', source: 'captured', text: "every config file is a tiny apology for a decision you didn't want to hardcode." },
  { id: 'l8', type: 'post', source: 'captured', text: "low key the best dev tool is a second monitor and the discipline to not put slack on it." },
];

// The tweet currently selected on X (reply context).
const REPLY_CONTEXT = {
  author: 'Lena Park',
  handle: 'lenabuilds',
  text: "everyone says \"just use the platform\" but the platform changes its mind every 18 months and your code doesn't get a vote. how are people actually deciding what to bet on?",
  grandparent: "starting a new side project and I'm paralyzed by the framework choice again.",
};

// Generic, non-X timeline content for the page behind the panel.
const TIMELINE = [
  { lines: [88, 64], target: false },
  { lines: [96, 92, 50], target: true },   // the one being replied to
  { lines: [70], target: false },
  { lines: [90, 78, 60], target: false },
  { lines: [82, 48], target: false },
];

// Canned generated drafts per mode. Regenerate cycles through.
const DRAFTS = {
  post: [
    "the framework wars are a distraction. pick the boring one with the biggest hiring pool and spend the saved energy on the part nobody can npm install: knowing your users.",
    "betting on a framework is really betting on a community's attention span. boring tech wins because boring tech is still here in 18 months.",
    "you don't choose a framework, you choose whose maintenance burden you'd rather inherit. pick the one whose tradeoffs you can live with at 2am.",
  ],
  reply: [
    "the honest answer: you can't out-predict the platform, so stop trying. bet on the thing you can rewrite in a weekend if it betrays you. small surface area beats clever every time.",
    "decide on reversibility, not correctness. the right bet is whichever one is cheapest to undo when the platform inevitably changes its mind.",
    "pick the option your future self can debug at 2am. \"will this still make sense to me in a year\" has saved me more than any benchmark.",
  ],
};

// Refine chips (editable in Prompts settings).
const CHIPS = [
  { id: 'c1', label: 'Shorter', instruction: 'Cut it down. Keep only the sharpest line.' },
  { id: 'c2', label: 'Warmer', instruction: 'Make it sound more generous and less combative.' },
  { id: 'c3', label: 'Punchier', instruction: 'Tighten the rhythm. Lead with the strongest claim.' },
  { id: 'c4', label: 'Less hot-take', instruction: 'Dial down the contrarian framing.' },
];

// Variant text used when a chip / more-less is applied (illustrative).
const REFINE_VARIANTS = {
  Shorter: "boring tech wins because boring tech is still here in 18 months. bet on what survives.",
  Warmer: "totally fair to feel stuck here. the thing that helped me: bet on what's cheap to undo, not what's \"correct\" — the platform will change its mind, and that's okay.",
  Punchier: "stop trying to out-predict the platform. bet on the thing you can rewrite in a weekend. small surface area beats clever, every time.",
  'Less hot-take': "framework choice matters less than people think. pick the well-supported option and put your energy into understanding your users — that part never gets deprecated.",
};

const PROMPT_TEMPLATES = [
  { key: 'reply', group: 'Generation', label: 'Reply', slots: ['context', 'bullets', 'examples', 'rules'],
    body: "You are drafting a reply in the user's voice.\n\nThey are replying to:\n{{context}}\n\nTheir notes:\n{{bullets}}\n\nExamples of how they write:\n{{examples}}\n\nWrite one reply. {{rules}}" },
  { key: 'post', group: 'Generation', label: 'Post', slots: ['bullets', 'examples', 'rules'],
    body: "You are drafting a standalone post in the user's voice.\n\nTheir notes:\n{{bullets}}\n\nExamples of how they write:\n{{examples}}\n\nWrite one post. {{rules}}" },
  { key: 'chipRefine', group: 'Refine', label: 'Chip refine', slots: ['instruction', 'draft', 'rules'],
    body: "Rewrite this draft. {{instruction}}\n\nDraft:\n{{draft}}\n\nKeep the user's voice. {{rules}}" },
  { key: 'moreLessRefine', group: 'Refine', label: 'More / less refine', slots: ['more', 'less', 'draft', 'rules'],
    def: "Rewrite this draft.\nMore of: {{more}}\nLess of: {{less}}\n\nDraft:\n{{draft}}\n\n{{rules}}",
    body: "Rewrite this draft, leaning harder.\nMore of: {{more}}\nLess of: {{less}}\n\nDraft:\n{{draft}}" },
  { key: 'repair', group: 'Repair', label: 'Repair', slots: ['draft', 'violations'],
    body: "The draft below violates a rule. Fix only the flagged span(s), change nothing else.\n\n{{draft}}\n\nViolations:\n{{violations}}" },
  { key: 'tighten', group: 'Repair', label: 'Tighten', slots: ['over', 'draft'],
    body: "This draft is {{over}} characters over 280. Cut it to fit without losing the core point.\n\n{{draft}}" },
];

// The exact text last sent to Anthropic (session-only in the real product).
const LAST_PROMPT = {
  model: 'claude-sonnet-4',
  when: '2 minutes ago',
  system: "You write X posts and replies in the user's voice. Match their rhythm, length, and vocabulary from the examples. Do not use em dashes or smart quotes. Avoid: delve, tapestry, leverage, in the realm of, game-changer. Output only the post text \u2014 no preamble, no quotes.",
  user: "Replying to @lenabuilds:\n\"everyone says 'just use the platform' but the platform changes its mind every 18 months and your code doesn't get a vote. how are people actually deciding what to bet on?\"\n\nMy angle:\n- reversibility beats correctness\n- bet on what's cheap to undo\n\nExamples of how I write:\n- \"shipping something every day is less about the shipping and more about the forcing function.\"\n- \"honestly the boring answer is usually right here.\"\n\nWrite one reply, under 280 characters.",
  response: "the honest answer: you can't out-predict the platform, so stop trying. bet on the thing you can rewrite in a weekend if it betrays you. small surface area beats clever every time.",
};

const BANLIST = ['delve', 'tapestry', 'leverage', 'in the realm of', 'it\'s important to note', 'game-changer'];

// Approximate X-weighted length: URLs count as 23, everything else 1.
function weighted(s) {
  if (!s) return 0;
  let t = s.replace(/https?:\/\/\S+/g, '_'.repeat(23));
  return [...t].length;
}

Object.assign(window, {
  HANDLE, LIBRARY, REPLY_CONTEXT, TIMELINE, DRAFTS, CHIPS, REFINE_VARIANTS,
  PROMPT_TEMPLATES, LAST_PROMPT, BANLIST, weighted,
});
