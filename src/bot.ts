import "dotenv/config";
import { Telegraf } from "telegraf";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.");
}

if (process.env.ALLOWED_TELEGRAM_USER_IDS === undefined) {
  throw new Error(
    "ALLOWED_TELEGRAM_USER_IDS is not set. Add it to .env (can be empty at first - run the bot, " +
      "message it, and your rejected user ID will be logged below so you can add it)."
  );
}

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
if (!deepseekApiKey) {
  throw new Error("DEEPSEEK_API_KEY is not set. Copy .env.example to .env and fill it in.");
}

const deepseek = new OpenAI({
  apiKey: deepseekApiKey,
  baseURL: "https://api.deepseek.com",
});

const githubPat = process.env.GITHUB_PAT;
if (!githubPat) {
  throw new Error("GITHUB_PAT is not set. Copy .env.example to .env and fill it in.");
}

const githubRepoFull = process.env.GITHUB_REPO;
if (!githubRepoFull) {
  throw new Error("GITHUB_REPO is not set. Copy .env.example to .env and fill it in (format: owner/repo).");
}

const [githubOwner, githubRepo] = githubRepoFull.split("/");
if (!githubOwner || !githubRepo) {
  throw new Error(`GITHUB_REPO must be in "owner/repo" format, got: ${githubRepoFull}`);
}

const octokit = new Octokit({ auth: githubPat });

const allowedUserIds = new Set(
  process.env.ALLOWED_TELEGRAM_USER_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map(Number)
);

export const bot = new Telegraf(token);

bot.use((ctx, next) => {
  const senderId = ctx.from?.id;
  if (senderId === undefined || !allowedUserIds.has(senderId)) {
    console.log(`Ignored message from unauthorized user ID: ${senderId}`);
    return;
  }
  return next();
});

const TELEGRAM_FORMATTING_NOTE =
  "This text is shown directly in Telegram, not GitHub, so format it for Telegram's Markdown: " +
  "use *word* (single asterisks) for bold, _word_ for italic, no ## headers, no markdown tables, plain paragraphs.";

type Intent = "chat" | "issue" | "pr";

async function classifyIntent(message: string): Promise<Intent> {
  const completion = await deepseek.chat.completions.create({
    model: "deepseek-v4-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify the developer's Telegram message into exactly one intent for a GitHub agent. " +
          'Reply with ONLY a json object shaped like {"intent": "chat" | "issue" | "pr"}. ' +
          '"issue" = they want a bug/task tracked as a GitHub issue (reporting a problem, asking to file/log something). ' +
          '"pr" = they want an actual file/code change made and submitted as a pull request. ' +
          '"chat" = anything else: greetings, questions, general conversation, or anything unclear. ' +
          'If you are not confident it is "issue" or "pr", choose "chat".',
      },
      { role: "user", content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return "chat";
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.intent === "issue" || parsed.intent === "pr") {
      return parsed.intent;
    }
  } catch {
    // falls through to the safe "chat" default below
  }
  return "chat";
}

function fallbackIssueFields(message: string): { title: string; body: string } {
  const firstLine = message.split("\n")[0].trim();
  const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return { title: title || "Untitled issue", body: message };
}

async function interpretAsIssue(message: string): Promise<{ title: string; body: string }> {
  const completion = await deepseek.chat.completions.create({
    model: "deepseek-v4-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You turn a developer's message into a GitHub issue. Reply with ONLY a json object " +
          'shaped like {"title": "short summary", "body": "fuller description"} and nothing else.',
      },
      { role: "user", content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return fallbackIssueFields(message);
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.title === "string" && typeof parsed.body === "string" && parsed.title.trim()) {
      return { title: parsed.title, body: parsed.body };
    }
  } catch {
    // fall through to heuristic fallback below
  }
  return fallbackIssueFields(message);
}

function isSafeRepoPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("..");
}

async function fetchRepoFileList(defaultBranch: string): Promise<string[]> {
  try {
    const { data: tree } = await octokit.rest.git.getTree({
      owner: githubOwner,
      repo: githubRepo,
      tree_sha: defaultBranch,
      recursive: "true",
    });
    return tree.tree
      .filter((entry): entry is typeof entry & { path: string } => entry.type === "blob" && typeof entry.path === "string")
      .map((entry) => entry.path)
      .slice(0, 300);
  } catch (err) {
    if ((err as { status?: number }).status === 409) {
      return []; // empty repo, no commits yet
    }
    throw err;
  }
}

async function fetchFile(path: string, ref: string): Promise<{ content: string; sha: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: githubOwner, repo: githubRepo, path, ref });
    if (!Array.isArray(data) && data.type === "file" && data.content) {
      return { content: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha };
    }
    return null;
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

type PrPlan = { canFulfill: true; path: string } | { canFulfill: false; reason: string };

async function planCodeChange(message: string, fileList: string[]): Promise<PrPlan> {
  const completion = await deepseek.chat.completions.create({
    model: "deepseek-v4-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You decide whether a developer's message can be turned into a single small file change for a " +
          "GitHub pull request, given the repository's current file list below. Reply with ONLY a json object: " +
          'if it can be done, {"canFulfill": true, "path": "relative/file/path.ext"} — reuse an existing path ' +
          "from the list when updating a file, or give a sensible new relative path when creating one. If it " +
          'genuinely cannot be done, reply {"canFulfill": false, "reason": "short explanation for the developer"}. ' +
          `The "reason" field is the only part of this response a person ever reads. ${TELEGRAM_FORMATTING_NOTE}\n\n` +
          `Repository files:\n${fileList.join("\n") || "(repository has no files yet)"}`,
      },
      { role: "user", content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { canFulfill: false, reason: "DeepSeek returned an empty response while planning the change." };
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.canFulfill === true && typeof parsed.path === "string" && isSafeRepoPath(parsed.path)) {
      return { canFulfill: true, path: parsed.path };
    }
    if (parsed.canFulfill === false && typeof parsed.reason === "string") {
      return { canFulfill: false, reason: parsed.reason };
    }
  } catch {
    // falls through to the generic failure below
  }
  return { canFulfill: false, reason: "Couldn't determine a valid file change from that message." };
}

type CodeDraft = {
  content: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
};

async function draftCodeChange(
  message: string,
  path: string,
  existingContent: string | null,
  fileList: string[]
): Promise<CodeDraft | null> {
  const completion = await deepseek.chat.completions.create({
    model: "deepseek-v4-flash",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You write the complete new content for one file in a GitHub pull request, grounded in the repository's " +
          "current file list and (if the file already exists) its current content below. " +
          'Reply with ONLY a json object shaped like {"content": "full new file content", "commitMessage": ' +
          '"short commit message", "prTitle": "short PR title", "prBody": "PR description"}. "content" must be ' +
          "the COMPLETE new content of the file, not a diff.\n\n" +
          `Target file: ${path}\n` +
          `Repository files:\n${fileList.join("\n") || "(repository has no files yet)"}\n\n` +
          (existingContent !== null
            ? `Current content of ${path}:\n${existingContent}`
            : `${path} does not exist yet - this change will create it.`),
      },
      { role: "user", content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.content === "string" &&
      typeof parsed.commitMessage === "string" &&
      typeof parsed.prTitle === "string" &&
      typeof parsed.prBody === "string"
    ) {
      return parsed as CodeDraft;
    }
  } catch {
    // falls through to the null return below
  }
  return null;
}

async function handleChat(message: string): Promise<string> {
  const completion = await deepseek.chat.completions.create({
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: TELEGRAM_FORMATTING_NOTE },
      { role: "user", content: message },
    ],
  });
  const reply = completion.choices[0]?.message?.content;
  return reply ?? "DeepSeek returned an empty response.";
}

async function handleIssueRequest(message: string): Promise<string> {
  const { title, body } = await interpretAsIssue(message);
  const issue = await octokit.rest.issues.create({ owner: githubOwner, repo: githubRepo, title, body });
  return `Created issue #${issue.data.number}: ${issue.data.html_url}`;
}

async function handlePrRequest(message: string): Promise<string> {
  const { data: repoInfo } = await octokit.rest.repos.get({ owner: githubOwner, repo: githubRepo });
  const defaultBranch = repoInfo.default_branch;

  const fileList = await fetchRepoFileList(defaultBranch);

  const plan = await planCodeChange(message, fileList);
  if (!plan.canFulfill) {
    return `Couldn't open a PR for that: ${plan.reason}`;
  }

  const existingFile = await fetchFile(plan.path, defaultBranch);

  const draft = await draftCodeChange(message, plan.path, existingFile?.content ?? null, fileList);
  if (!draft) {
    return "Sorry, I couldn't turn that into a file change. Try describing the file and what it should contain.";
  }

  const { data: baseRef } = await octokit.rest.git.getRef({
    owner: githubOwner,
    repo: githubRepo,
    ref: `heads/${defaultBranch}`,
  });

  const branchName = `agent/${Date.now()}`;
  await octokit.rest.git.createRef({
    owner: githubOwner,
    repo: githubRepo,
    ref: `refs/heads/${branchName}`,
    sha: baseRef.object.sha,
  });

  await octokit.rest.repos.createOrUpdateFileContents({
    owner: githubOwner,
    repo: githubRepo,
    path: plan.path,
    message: draft.commitMessage,
    content: Buffer.from(draft.content, "utf-8").toString("base64"),
    branch: branchName,
    sha: existingFile?.sha,
  });

  const { data: pr } = await octokit.rest.pulls.create({
    owner: githubOwner,
    repo: githubRepo,
    title: draft.prTitle,
    head: branchName,
    base: defaultBranch,
    body: draft.prBody,
  });

  return `Opened PR #${pr.number}: ${pr.html_url}`;
}

bot.on("text", async (ctx) => {
  const message = ctx.message.text;
  const placeholder = await ctx.reply("Thinking...");

  let resultText: string;
  try {
    const intent = await classifyIntent(message);
    if (intent === "issue") {
      resultText = await handleIssueRequest(message);
    } else if (intent === "pr") {
      resultText = await handlePrRequest(message);
    } else {
      resultText = await handleChat(message);
    }
  } catch (err) {
    console.error("Failed to handle message:", err);
    resultText = "Sorry, something went wrong handling that message.";
  }

  try {
    await ctx.telegram.editMessageText(ctx.chat.id, placeholder.message_id, undefined, resultText, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Formatted reply failed, falling back to plain text:", err);
    await ctx.telegram.editMessageText(ctx.chat.id, placeholder.message_id, undefined, resultText);
  }
});
