import { NextRequest, NextResponse } from "next/server";
import { Agent, CursorAgentError } from "@cursor/sdk";
import path from "path";
import fs from "fs";
import { getJob, listRules } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { jobId, message, agentId, model: modelId } = await req.json();
  const model = modelId || "composer-2.5";

  if (!jobId || !message) {
    return NextResponse.json({ error: "jobId and message are required" }, { status: 400 });
  }

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "CURSOR_API_KEY not set" }, { status: 500 });
  }

  const job = getJob(Number(jobId));
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const resumePath = path.join(process.cwd(), "resumes", "tailored", `job-${jobId}.md`);
  const basePath = path.join(process.cwd(), "resumes", "base-resume.md");
  const notesPath = path.join(process.cwd(), "resumes", "tailored", `job-${jobId}-notes.md`);

  const tailoredResume = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, "utf-8") : null;
  const baseResume = fs.existsSync(basePath) ? fs.readFileSync(basePath, "utf-8") : null;
  const notes = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf-8") : null;
  const rules = listRules().filter((r) => r.is_active).map((r) => r.rule_text).join("\n");

  // Build system context (only injected on first turn; on resume turns the agent remembers it)
  const systemContext = `You are a resume coach helping refine a tailored resume.

## Context

**Job:** ${job.title} at ${job.company}
**Job Description:**
${job.description}

**Active Tailoring Rules:**
${rules}

**Base Resume:**
${baseResume ?? "(not uploaded)"}

**Current Tailored Resume (file: ${resumePath}):**
${tailoredResume ?? "(not generated yet)"}

**Change Notes from Previous Generation:**
${notes ?? "(none)"}

## Your Behaviour

- Answer questions about any change made and why.
- When the user asks you to modify the resume, show the proposed full updated resume wrapped in a fenced code block tagged with \`RESUME_PROPOSAL\`:

\`\`\`RESUME_PROPOSAL
[full updated resume in markdown here]
\`\`\`

- Always show the full resume in the proposal, not just the changed section.
- After the proposal block, briefly explain what you changed and why.
- Do NOT write the file yourself — the user will confirm before it is saved.
- Never fabricate experience, skills, or credentials not in the base resume.
- If a request would require fabrication, explain what is missing and suggest alternatives.`;

  // Streaming response via ReadableStream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        let reply = "";
        let newAgentId: string | undefined;

        const streamAgent = async (a: Awaited<ReturnType<typeof Agent.create>>, prompt: string) => {
          const run = await a.send(prompt);
          newAgentId = a.agentId;
          for await (const event of run.stream()) {
            if (event.type === "assistant") {
              for (const block of event.message.content) {
                if (block.type === "text") {
                  reply += block.text;
                  send({ type: "chunk", text: block.text });
                }
              }
            }
          }
          await run.wait();
          if (typeof a[Symbol.asyncDispose] === "function") await a[Symbol.asyncDispose]();
        };

        if (agentId) {
          // Resume existing conversation — fall back to fresh agent if session is stale
          try {
            const agent = await Agent.resume(agentId, { apiKey });
            await streamAgent(agent, message);
          } catch {
            // ponytail: stale agentId (expired session); start fresh with full context
            const agent = await Agent.create({ apiKey, model: { id: model }, local: { cwd: process.cwd() } });
            const fullPrompt = `${systemContext}\n\n---\n\nUser: ${message}`;
            await streamAgent(agent, fullPrompt);
          }
        } else {
          // First message — create agent with streaming
          const agent = await Agent.create({ apiKey, model: { id: model }, local: { cwd: process.cwd() } });
          const fullPrompt = `${systemContext}\n\n---\n\nUser: ${message}`;
          await streamAgent(agent, fullPrompt);
        }

        // Check if there's a resume proposal in the reply
        const proposalMatch = reply.match(/```RESUME_PROPOSAL\n([\s\S]*?)```/);
        const proposal = proposalMatch ? proposalMatch[1].trim() : null;

        send({ type: "done", agentId: newAgentId, proposal });
        controller.close();
      } catch (err) {
        const msg = err instanceof CursorAgentError
          ? `Agent error: ${err.message}`
          : String(err);
        send({ type: "error", error: msg });
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Apply a proposed resume update
export async function PATCH(req: NextRequest) {
  try {
    const { jobId, content } = await req.json();
    if (!jobId || !content) {
      return NextResponse.json({ error: "jobId and content required" }, { status: 400 });
    }
    const resumePath = path.join(process.cwd(), "resumes", "tailored", `job-${jobId}.md`);
    fs.writeFileSync(resumePath, content, "utf-8");
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
